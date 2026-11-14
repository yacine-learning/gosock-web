// offsets: who shares the place where the next read starts?
// It opens /tmp/hello.txt twice, duplicates the first descriptor, reads 5 bytes
// at a time from each, moves one offset back to 0, then waits so you can look
// at the kernel view. Press Enter to exit.
package main

import (
	"fmt"
	"syscall"
)

func main() {
	a, _ := syscall.Open("/tmp/hello.txt", syscall.O_RDONLY, 0) // a new open file description
	b, _ := syscall.Open("/tmp/hello.txt", syscall.O_RDONLY, 0) // another one, with its own offset
	c, _ := syscall.Dup(a)                                      // a second number for the FIRST one
	fmt.Printf("a=%d b=%d c=%d (c is a dup of a)\n", a, b, c)

	read5("a", a)
	read5("b", b)
	read5("c", c) // continues where a stopped: they share one offset
	read5("a", a)

	pos, _ := syscall.Seek(c, 0, 0) // lseek: move c's offset back to the start...
	fmt.Printf("seek c to %d\n", pos)
	read5("a", a) // ...and a's, since it is the same one

	fmt.Println("look at the kernel view, then press Enter")
	syscall.Read(0, make([]byte, 1))
}

func read5(name string, fd int) {
	buf := make([]byte, 5)
	n, _ := syscall.Read(fd, buf)
	fmt.Printf("read %s -> %q\n", name, buf[:n])
}
