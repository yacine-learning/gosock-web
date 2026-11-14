// gosock-web: socket system calls for js/wasm. Every call goes to the simulated
// kernel through the same bridge the file calls use (the JavaScript object "fs").

//go:build js && wasm

package syscall

import "syscall/js"

// GosockSocketFD is set by package net: it tells package os whether a writer is a
// TCP connection, and which descriptor it uses, so that os can call sendfile.
var GosockSocketFD func(w any) (fd int, ok bool)

func registerFD(fd int) {
	filesMu.Lock()
	files[fd] = &jsFile{}
	filesMu.Unlock()
}

func ip4String(a [4]byte) string {
	return itoa4(a[0]) + "." + itoa4(a[1]) + "." + itoa4(a[2]) + "." + itoa4(a[3])
}

func itoa4(b byte) string {
	if b == 0 {
		return "0"
	}
	var buf [3]byte
	i := 3
	for b > 0 {
		i--
		buf[i] = '0' + b%10
		b /= 10
	}
	return string(buf[i:])
}

func sockaddrArgs(sa Sockaddr) (string, int, error) {
	switch a := sa.(type) {
	case *SockaddrInet4:
		return ip4String(a.Addr), a.Port, nil
	case *SockaddrInet6:
		// the simulator is IPv4 only: accept "::" and v4-mapped addresses
		zero := true
		for _, b := range a.Addr[:10] {
			if b != 0 {
				zero = false
			}
		}
		if zero && a.Addr[10] == 0xff && a.Addr[11] == 0xff {
			return ip4String([4]byte{a.Addr[12], a.Addr[13], a.Addr[14], a.Addr[15]}), a.Port, nil
		}
		if zero && a.Addr[10] == 0 && a.Addr[11] == 0 && a.Addr[12] == 0 && a.Addr[13] == 0 && a.Addr[14] == 0 && a.Addr[15] == 0 {
			return "0.0.0.0", a.Port, nil
		}
	}
	return "", 0, EAFNOSUPPORT
}

func sockaddrFromJS(v js.Value) Sockaddr {
	sa := &SockaddrInet4{Port: v.Get("port").Int()}
	ip := v.Get("ip").String()
	n, part := 0, 0
	for i := 0; i < len(ip) && part < 4; i++ {
		if ip[i] == '.' {
			sa.Addr[part] = byte(n)
			part++
			n = 0
		} else {
			n = n*10 + int(ip[i]-'0')
		}
	}
	if part < 4 {
		sa.Addr[part] = byte(n)
	}
	return sa
}

func Socket(domain, sotype, proto int) (fd int, err error) {
	v, err := fsCall("socket", domain, sotype, proto)
	if err != nil {
		return -1, err
	}
	fd = v.Int()
	registerFD(fd)
	return fd, nil
}

func Bind(fd int, sa Sockaddr) error {
	ip, port, err := sockaddrArgs(sa)
	if err != nil {
		return err
	}
	_, err = fsCall("bind", fd, ip, port)
	return err
}

func StopIO(fd int) error {
	return ENOSYS
}

func Listen(fd int, backlog int) error {
	_, err := fsCall("listen", fd, backlog)
	return err
}

func Accept(fd int) (newfd int, sa Sockaddr, err error) {
	v, err := fsCall("accept", fd)
	if err != nil {
		return -1, nil, err
	}
	newfd = v.Get("fd").Int()
	registerFD(newfd)
	return newfd, sockaddrFromJS(v), nil
}

func Connect(fd int, sa Sockaddr) error {
	ip, port, err := sockaddrArgs(sa)
	if err != nil {
		return err
	}
	_, err = fsCall("connect", fd, ip, port)
	return err
}

func Getsockname(fd int) (Sockaddr, error) {
	v, err := fsCall("getsockname", fd)
	if err != nil {
		return nil, err
	}
	return sockaddrFromJS(v), nil
}

func Getpeername(fd int) (Sockaddr, error) {
	v, err := fsCall("getpeername", fd)
	if err != nil {
		return nil, err
	}
	return sockaddrFromJS(v), nil
}

func Recvfrom(fd int, p []byte, flags int) (n int, from Sockaddr, err error) {
	n, err = Read(fd, p)
	return n, nil, err
}

func Sendto(fd int, p []byte, flags int, to Sockaddr) error {
	_, err := Write(fd, p)
	return err
}

func Recvmsg(fd int, p, oob []byte, flags int) (n, oobn, recvflags int, from Sockaddr, err error) {
	return 0, 0, 0, nil, ENOSYS
}

func SendmsgN(fd int, p, oob []byte, to Sockaddr, flags int) (n int, err error) {
	return 0, ENOSYS
}

func GetsockoptInt(fd, level, opt int) (value int, err error) {
	v, err := fsCall("getsockopt", fd, level, opt)
	if err != nil {
		return 0, err
	}
	return v.Int(), nil
}

func SetsockoptInt(fd, level, opt int, value int) error {
	_, err := fsCall("setsockopt", fd, level, opt, value)
	return err
}

func SetReadDeadline(fd int, t int64) error {
	return ENOSYS
}

func SetWriteDeadline(fd int, t int64) error {
	return ENOSYS
}

func Shutdown(fd int, how int) error {
	_, err := fsCall("shutdown", fd, how)
	return err
}

func SetNonblock(fd int, nonblocking bool) error {
	return nil
}

// Sendfile copies up to count bytes from infd to outfd inside the kernel.
// offset must be nil: the file's own offset is used and advanced.
func Sendfile(outfd int, infd int, offset *int64, count int) (written int, err error) {
	if offset != nil {
		return 0, EINVAL
	}
	v, err := fsCall("sendfile", outfd, infd, count)
	if err != nil {
		return 0, err
	}
	return v.Int(), nil
}
