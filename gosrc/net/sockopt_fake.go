// gosock-web: socket options go to the simulated kernel.

//go:build js || wasip1

package net

import (
	"os"
	"syscall"
)

func setDefaultSockopts(s, family, sotype int, ipv6only bool) error {
	return nil
}

func setDefaultListenerSockopts(s int) error {
	return os.NewSyscallError("setsockopt", syscall.SetsockoptInt(s, syscall.SOL_SOCKET, syscall.SO_REUSEADDR, 1))
}

func setDefaultMulticastSockopts(s int) error {
	return nil
}

func setReadBuffer(fd *netFD, bytes int) error {
	return os.NewSyscallError("setsockopt", syscall.SetsockoptInt(fd.fakeNetFD.sysfd, syscall.SOL_SOCKET, syscall.SO_RCVBUF, bytes))
}

func setWriteBuffer(fd *netFD, bytes int) error {
	return os.NewSyscallError("setsockopt", syscall.SetsockoptInt(fd.fakeNetFD.sysfd, syscall.SOL_SOCKET, syscall.SO_SNDBUF, bytes))
}

func setKeepAlive(fd *netFD, keepalive bool) error {
	v := 0
	if keepalive {
		v = 1
	}
	return os.NewSyscallError("setsockopt", syscall.SetsockoptInt(fd.fakeNetFD.sysfd, syscall.SOL_SOCKET, syscall.SO_KEEPALIVE, v))
}

func setLinger(fd *netFD, sec int) error {
	return nil
}
