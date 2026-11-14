// rawcopy: copy a file with nothing but system calls.
//
//	rawcopy SRC DST    copy SRC into DST (created, or emptied if it exists)
//
// It prints "copied N bytes" when done. On any error it prints "rawcopy: ..." on
// standard error and exits with status 1.
//
// Add "syscall" to the imports when you start (the editor adds it when you pick
// syscall in the completion list).
package main

import (
	"fmt"
	"os"
)

func rawcopy(src, dst string) (int, error) {
	// TODO(a): open src for reading (syscall.Open, flag syscall.O_RDONLY, mode 0).
	//          On error return it, as fmt.Errorf("open %s: %w", src, err).
	//          The descriptor must be closed when rawcopy returns (syscall.Close).
	// TODO(b): open dst for writing, created if missing and emptied if not:
	//          flags syscall.O_WRONLY|syscall.O_CREAT|syscall.O_TRUNC, mode 0644.
	//          Same error shape, same close.
	// TODO(c): loop: syscall.Read into a 64 KB buffer (make([]byte, 64*1024)) until it
	//          returns 0 bytes; write every byte you read with writeAll; count them.
	return 0, fmt.Errorf("not implemented yet") // delete this line when you are done
}

// writeAll writes all of b to fd. syscall.Write may take FEWER bytes than you give it:
// it returns how many it took, and you must write the rest yourself.
func writeAll(fd int, b []byte) error {
	// TODO(d): loop while b is not empty: n, err := syscall.Write(fd, b);
	//          on error return it; otherwise drop the n bytes written: b = b[n:].
	return fmt.Errorf("writeAll: not implemented yet") // delete this line when you are done
}

func main() {
	if len(os.Args) != 3 {
		fmt.Fprintln(os.Stderr, "usage: rawcopy SRC DST")
		os.Exit(2)
	}
	n, err := rawcopy(os.Args[1], os.Args[2])
	if err != nil {
		fmt.Fprintln(os.Stderr, "rawcopy:", err)
		os.Exit(1)
	}
	fmt.Printf("copied %d bytes\n", n)
}
