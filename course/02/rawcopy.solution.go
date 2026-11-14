// rawcopy: copy a file with nothing but system calls.
//
//	rawcopy SRC DST    copy SRC into DST (created, or emptied if it exists)
//
// It prints "copied N bytes" when done. On any error it prints "rawcopy: ..." on
// standard error and exits with status 1.
package main

import (
	"fmt"
	"os"
	"syscall"
)

// rawcopy opens both files, then moves the bytes in 64 KB chunks.
func rawcopy(src, dst string) (int, error) {
	in, err := syscall.Open(src, syscall.O_RDONLY, 0)
	if err != nil {
		return 0, fmt.Errorf("open %s: %w", src, err)
	}
	defer syscall.Close(in)
	out, err := syscall.Open(dst, syscall.O_WRONLY|syscall.O_CREAT|syscall.O_TRUNC, 0644)
	if err != nil {
		return 0, fmt.Errorf("open %s: %w", dst, err)
	}
	defer syscall.Close(out)
	buf := make([]byte, 64*1024)
	total := 0
	for {
		n, err := syscall.Read(in, buf)
		if err != nil {
			return total, fmt.Errorf("read %s: %w", src, err)
		}
		if n == 0 {
			return total, nil
		}
		if err := writeAll(out, buf[:n]); err != nil {
			return total, fmt.Errorf("write %s: %w", dst, err)
		}
		total += n
	}
}

// writeAll writes all of b to fd, however many calls it takes.
func writeAll(fd int, b []byte) error {
	for len(b) > 0 {
		n, err := syscall.Write(fd, b)
		if err != nil {
			return err
		}
		b = b[n:]
	}
	return nil
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
