// gosock-web: io.Copy(conn, file) becomes the sendfile system call, as on Linux.

//go:build !(linux || (darwin && !ios) || dragonfly || freebsd || solaris || windows)

package net

import (
	"io"
	"os"
	"syscall"
)

const supportsSendfile = true

func sendFile(c *netFD, r io.Reader) (written int64, err error, handled bool) {
	var remain int64 = 0 // 0 means: until end of file
	lr, ok := r.(*io.LimitedReader)
	if ok {
		remain, r = lr.N, lr.R
		if remain <= 0 {
			return 0, nil, true
		}
	}
	f, ok := r.(*os.File)
	if !ok || c.fakeNetFD == nil {
		return 0, nil, false
	}
	for {
		count := 2147483647
		if remain > 0 && remain-written < int64(count) {
			count = int(remain - written)
		}
		n, e := syscall.Sendfile(c.fakeNetFD.sysfd, int(f.Fd()), nil, count)
		written += int64(n)
		if e != nil {
			err = e
			break
		}
		if n == 0 || (remain > 0 && written >= remain) {
			break
		}
	}
	if lr != nil {
		lr.N = remain - written
	}
	return written, wrapSyscallError("sendfile", err), true
}
