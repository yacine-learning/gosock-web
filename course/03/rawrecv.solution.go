// rawrecv: gosock recv, without package net: the socket calls one by one.
//
//	rawrecv PORT DEST    listen on PORT (every address), accept ONE connection,
//	                     store what arrives in DEST, print "received N bytes"
//
// On any error it prints "rawrecv: ..." on standard error and exits with status 1.
package main

import (
	"fmt"
	"os"
	"strconv"
	"syscall"
)

// rawrecv: socket, setsockopt, bind, listen, accept, then the copy loop.
func rawrecv(port int, dest string) (int, error) {
	ls, err := syscall.Socket(syscall.AF_INET, syscall.SOCK_STREAM, 0)
	if err != nil {
		return 0, fmt.Errorf("socket: %w", err)
	}
	defer syscall.Close(ls)
	if err := syscall.SetsockoptInt(ls, syscall.SOL_SOCKET, syscall.SO_REUSEADDR, 1); err != nil {
		return 0, fmt.Errorf("setsockopt: %w", err)
	}
	if err := syscall.Bind(ls, &syscall.SockaddrInet4{Port: port}); err != nil {
		return 0, fmt.Errorf("bind: %w", err)
	}
	if err := syscall.Listen(ls, 8); err != nil {
		return 0, fmt.Errorf("listen: %w", err)
	}
	fd, _, err := syscall.Accept(ls)
	if err != nil {
		return 0, fmt.Errorf("accept: %w", err)
	}
	defer syscall.Close(fd)
	out, err := syscall.Open(dest, syscall.O_WRONLY|syscall.O_CREAT|syscall.O_TRUNC, 0644)
	if err != nil {
		return 0, fmt.Errorf("open %s: %w", dest, err)
	}
	defer syscall.Close(out)
	buf := make([]byte, 64*1024)
	total := 0
	for {
		n, err := syscall.Read(fd, buf)
		if err != nil {
			return total, fmt.Errorf("read: %w", err)
		}
		if n == 0 {
			return total, nil
		}
		if err := writeAll(out, buf[:n]); err != nil {
			return total, fmt.Errorf("write %s: %w", dest, err)
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
		fmt.Fprintln(os.Stderr, "usage: rawrecv PORT DEST")
		os.Exit(2)
	}
	port, err := strconv.Atoi(os.Args[1])
	if err != nil {
		fmt.Fprintln(os.Stderr, "rawrecv: bad port:", os.Args[1])
		os.Exit(2)
	}
	n, err := rawrecv(port, os.Args[2])
	if err != nil {
		fmt.Fprintln(os.Stderr, "rawrecv:", err)
		os.Exit(1)
	}
	fmt.Printf("received %d bytes\n", n)
}
