// gosock-web: TCP options go to the simulated kernel.

//go:build js || wasip1

package net

import (
	"os"
	"syscall"
	"time"
)

func setNoDelay(fd *netFD, noDelay bool) error {
	v := 0
	if noDelay {
		v = 1
	}
	return os.NewSyscallError("setsockopt", syscall.SetsockoptInt(fd.fakeNetFD.sysfd, syscall.IPPROTO_TCP, syscall.TCP_NODELAY, v))
}

func setKeepAliveIdle(fd *netFD, d time.Duration) error {
	if d == 0 {
		d = 15 * time.Second
	} else if d < 0 {
		return nil
	}
	return os.NewSyscallError("setsockopt", syscall.SetsockoptInt(fd.fakeNetFD.sysfd, syscall.IPPROTO_TCP, syscall.TCP_KEEPIDLE, int(d/time.Second)))
}

func setKeepAliveInterval(fd *netFD, d time.Duration) error {
	if d == 0 {
		d = 15 * time.Second
	} else if d < 0 {
		return nil
	}
	return os.NewSyscallError("setsockopt", syscall.SetsockoptInt(fd.fakeNetFD.sysfd, syscall.IPPROTO_TCP, syscall.TCP_KEEPINTVL, int(d/time.Second)))
}

func setKeepAliveCount(fd *netFD, n int) error {
	if n == 0 {
		n = 9
	} else if n < 0 {
		return nil
	}
	return os.NewSyscallError("setsockopt", syscall.SetsockoptInt(fd.fakeNetFD.sysfd, syscall.IPPROTO_TCP, syscall.TCP_KEEPCNT, n))
}
