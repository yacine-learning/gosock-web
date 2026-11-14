// rawcat: cat with nothing but system calls. Each syscall.X function is one call to
// the kernel, with the kernel's own arguments (a descriptor is a plain int) and
// result (a count, or an errno). No buffering, no helper, nothing in between.
//
//	rawcat FILE    print FILE
//	rawcat         print what arrives on standard input (descriptor 0)
package main

import (
	"fmt"
	"os"
	"syscall"
)

func main() {
	fd := 0 // standard input
	if len(os.Args) > 1 {
		var err error
		fd, err = syscall.Open(os.Args[1], syscall.O_RDONLY, 0)
		if err != nil {
			fail("open "+os.Args[1], err)
		}
	}
	buf := make([]byte, 4096)
	for {
		n, err := syscall.Read(fd, buf) // at most 4096 bytes, often fewer
		if err != nil {
			fail("read", err)
		}
		if n == 0 { // 0 bytes: the end of the file
			break
		}
		if _, err := syscall.Write(1, buf[:n]); err != nil {
			fail("write", err)
		}
	}
	syscall.Close(fd)
}

// fail prints the error, its name and its number, then exits with status 1.
func fail(what string, err error) {
	errno := err.(syscall.Errno) // the error a system call returns is a number
	fmt.Fprintf(os.Stderr, "rawcat: %s: %v (errno %d)\n", what, err, int(errno))
	os.Exit(1)
}
