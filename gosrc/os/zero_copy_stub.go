// gosock-web: io.Copy(conn, file) becomes the sendfile system call, as on Linux.

//go:build !linux

package os

import (
	"io"
	"syscall"
)

func (f *File) writeTo(w io.Writer) (written int64, handled bool, err error) {
	if syscall.GosockSocketFD == nil {
		return 0, false, nil
	}
	sock, ok := syscall.GosockSocketFD(w)
	if !ok {
		return 0, false, nil
	}
	for {
		n, e := syscall.Sendfile(sock, int(f.Fd()), nil, 2147483647)
		written += int64(n)
		if e != nil {
			return written, true, NewSyscallError("sendfile", e)
		}
		if n == 0 {
			return written, true, nil
		}
	}
}

func (f *File) readFrom(r io.Reader) (n int64, handled bool, err error) {
	return 0, false, nil
}
