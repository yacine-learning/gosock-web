// gosock-web: package net for js/wasm, on top of the simulated kernel's sockets.
// TCP over IPv4 only. Each method is one system call, made in blocking mode.

//go:build js || wasip1

package net

import (
	"context"
	"io"
	"os"
	"sync/atomic"
	"syscall"
	"time"
)

type fakeNetFD struct {
	fd     *netFD
	sysfd  int
	closed atomic.Bool
}

func init() {
	syscall.GosockSocketFD = func(w any) (int, bool) {
		c, ok := w.(*TCPConn)
		if !ok || c == nil || c.fd == nil || c.fd.fakeNetFD == nil {
			return 0, false
		}
		return c.fd.fakeNetFD.sysfd, true
	}
}

func sysSocket(family, sotype, proto int) (int, error) {
	return syscall.Socket(family, sotype, proto)
}

func toInet4(sa sockaddr) (*syscall.SockaddrInet4, error) {
	a, ok := sa.(*TCPAddr)
	if !ok {
		return nil, syscall.EAFNOSUPPORT
	}
	out := &syscall.SockaddrInet4{Port: a.Port}
	if len(a.IP) == 0 || a.IP.IsUnspecified() {
		return out, nil
	}
	ip4 := a.IP.To4()
	if ip4 == nil {
		return nil, syscall.EAFNOSUPPORT
	}
	copy(out.Addr[:], ip4)
	return out, nil
}

// a dialer without a local address passes a nil *TCPAddr inside the interface
func noAddr(sa sockaddr) bool {
	if sa == nil {
		return true
	}
	a, ok := sa.(*TCPAddr)
	return ok && a == nil
}

func fromInet4(sa syscall.Sockaddr) *TCPAddr {
	a, ok := sa.(*syscall.SockaddrInet4)
	if !ok {
		return &TCPAddr{}
	}
	return &TCPAddr{IP: IPv4(a.Addr[0], a.Addr[1], a.Addr[2], a.Addr[3]).To4(), Port: a.Port}
}

func socket(ctx context.Context, net string, family, sotype, proto int, ipv6only bool, laddr, raddr sockaddr, ctrlCtxFn func(context.Context, string, string, syscall.RawConn) error) (*netFD, error) {
	if sotype != syscall.SOCK_STREAM || ctrlCtxFn != nil {
		return nil, os.NewSyscallError("socket", syscall.ENOTSUP)
	}
	s, err := syscall.Socket(syscall.AF_INET, syscall.SOCK_STREAM, syscall.IPPROTO_TCP)
	if err != nil {
		return nil, os.NewSyscallError("socket", err)
	}
	fd := &netFD{family: syscall.AF_INET, sotype: sotype, net: net}
	fd.fakeNetFD = &fakeNetFD{fd: fd, sysfd: s}

	fail := func(call string, err error) (*netFD, error) {
		fd.fakeNetFD.Close()
		return nil, os.NewSyscallError(call, err)
	}

	if noAddr(raddr) { // a listener
		if err := setDefaultListenerSockopts(s); err != nil {
			fd.fakeNetFD.Close()
			return nil, err
		}
		la := &syscall.SockaddrInet4{}
		if !noAddr(laddr) {
			if la, err = toInet4(laddr); err != nil {
				return fail("bind", err)
			}
		}
		if err := syscall.Bind(s, la); err != nil {
			return fail("bind", err)
		}
		if err := syscall.Listen(s, listenerBacklog()); err != nil {
			return fail("listen", err)
		}
		lsa, err := syscall.Getsockname(s)
		if err != nil {
			return fail("getsockname", err)
		}
		fd.setAddr(fromInet4(lsa), nil)
		return fd, nil
	}

	if !noAddr(laddr) {
		la, err := toInet4(laddr)
		if err != nil {
			return fail("bind", err)
		}
		if err := syscall.Bind(s, la); err != nil {
			return fail("bind", err)
		}
	}
	ra, err := toInet4(raddr)
	if err != nil {
		return fail("connect", err)
	}
	if err := syscall.Connect(s, ra); err != nil {
		return fail("connect", err)
	}
	lsa, err := syscall.Getsockname(s)
	if err != nil {
		return fail("getsockname", err)
	}
	rsa, err := syscall.Getpeername(s)
	if err != nil {
		return fail("getpeername", err)
	}
	fd.isConnected = true
	fd.setAddr(fromInet4(lsa), fromInet4(rsa))
	return fd, nil
}

func (ffd *fakeNetFD) wrap(call string, err error) error {
	if err == nil {
		return nil
	}
	if ffd.closed.Load() {
		return ErrClosed
	}
	return os.NewSyscallError(call, err)
}

func (ffd *fakeNetFD) Read(p []byte) (n int, err error) {
	if ffd.closed.Load() {
		return 0, ErrClosed
	}
	n, err = syscall.Read(ffd.sysfd, p)
	if err != nil {
		return 0, ffd.wrap("read", err)
	}
	if n == 0 && len(p) > 0 {
		return 0, io.EOF
	}
	return n, nil
}

func (ffd *fakeNetFD) Write(p []byte) (nn int, err error) {
	if ffd.closed.Load() {
		return 0, ErrClosed
	}
	for nn < len(p) {
		n, err := syscall.Write(ffd.sysfd, p[nn:])
		if n > 0 {
			nn += n
		}
		if err != nil {
			return nn, ffd.wrap("write", err)
		}
		if n == 0 {
			return nn, io.ErrUnexpectedEOF
		}
	}
	return nn, nil
}

func (ffd *fakeNetFD) Close() (err error) {
	if ffd.closed.Swap(true) {
		return ErrClosed
	}
	return os.NewSyscallError("close", syscall.Close(ffd.sysfd))
}

func (ffd *fakeNetFD) closeRead() error {
	return ffd.wrap("shutdown", syscall.Shutdown(ffd.sysfd, syscall.SHUT_RD))
}

func (ffd *fakeNetFD) closeWrite() error {
	return ffd.wrap("shutdown", syscall.Shutdown(ffd.sysfd, syscall.SHUT_WR))
}

func (ffd *fakeNetFD) accept(laddr Addr) (*netFD, error) {
	if ffd.closed.Load() {
		return nil, ErrClosed
	}
	s, rsa, err := syscall.Accept(ffd.sysfd)
	if err != nil {
		return nil, ffd.wrap("accept", err)
	}
	fd := &netFD{family: syscall.AF_INET, sotype: syscall.SOCK_STREAM, net: ffd.fd.net, isConnected: true}
	fd.fakeNetFD = &fakeNetFD{fd: fd, sysfd: s}
	la := laddr
	if lsa, err := syscall.Getsockname(s); err == nil {
		la = fromInet4(lsa)
	}
	fd.setAddr(la, fromInet4(rsa))
	return fd, nil
}

// Deadlines are not simulated: calls block until the kernel answers.
func (ffd *fakeNetFD) SetDeadline(t time.Time) error      { return nil }
func (ffd *fakeNetFD) SetReadDeadline(t time.Time) error  { return nil }
func (ffd *fakeNetFD) SetWriteDeadline(t time.Time) error { return nil }

func (ffd *fakeNetFD) readFrom(p []byte) (n int, sa syscall.Sockaddr, err error) {
	return 0, nil, syscall.ENOTSUP
}
func (ffd *fakeNetFD) readFromInet4(p []byte, sa *syscall.SockaddrInet4) (n int, err error) {
	return 0, syscall.ENOTSUP
}
func (ffd *fakeNetFD) readFromInet6(p []byte, sa *syscall.SockaddrInet6) (n int, err error) {
	return 0, syscall.ENOTSUP
}
func (ffd *fakeNetFD) readMsg(p []byte, oob []byte, flags int) (n, oobn, retflags int, sa syscall.Sockaddr, err error) {
	return 0, 0, 0, nil, syscall.ENOTSUP
}
func (ffd *fakeNetFD) readMsgInet4(p []byte, oob []byte, flags int, sa *syscall.SockaddrInet4) (n, oobn, retflags int, err error) {
	return 0, 0, 0, syscall.ENOTSUP
}
func (ffd *fakeNetFD) readMsgInet6(p []byte, oob []byte, flags int, sa *syscall.SockaddrInet6) (n, oobn, retflags int, err error) {
	return 0, 0, 0, syscall.ENOTSUP
}
func (ffd *fakeNetFD) writeMsg(p []byte, oob []byte, sa syscall.Sockaddr) (n int, oobn int, err error) {
	return 0, 0, syscall.ENOTSUP
}
func (ffd *fakeNetFD) writeMsgInet4(p []byte, oob []byte, sa *syscall.SockaddrInet4) (n int, oobn int, err error) {
	return 0, 0, syscall.ENOTSUP
}
func (ffd *fakeNetFD) writeMsgInet6(p []byte, oob []byte, sa *syscall.SockaddrInet6) (n int, oobn int, err error) {
	return 0, 0, syscall.ENOTSUP
}
func (ffd *fakeNetFD) writeTo(p []byte, sa syscall.Sockaddr) (n int, err error) {
	return 0, syscall.ENOTSUP
}
func (ffd *fakeNetFD) writeToInet4(p []byte, sa *syscall.SockaddrInet4) (n int, err error) {
	return 0, syscall.ENOTSUP
}
func (ffd *fakeNetFD) writeToInet6(p []byte, sa *syscall.SockaddrInet6) (n int, err error) {
	return 0, syscall.ENOTSUP
}
func (ffd *fakeNetFD) dup() (f *os.File, err error) {
	return nil, syscall.ENOTSUP
}
func (ffd *fakeNetFD) setReadBuffer(bytes int) error  { return setReadBuffer(ffd.fd, bytes) }
func (ffd *fakeNetFD) setWriteBuffer(bytes int) error { return setWriteBuffer(ffd.fd, bytes) }
func (ffd *fakeNetFD) setLinger(sec int) error        { return nil }
