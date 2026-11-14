// rawrecv: gosock recv, without package net: the socket calls one by one.
//
//	rawrecv PORT DEST    listen on PORT (every address), accept ONE connection,
//	                     store what arrives in DEST, print "received N bytes"
//
// On any error it prints "rawrecv: ..." on standard error and exits with status 1.
// Add "syscall" to the imports when you start.
package main

import (
	"fmt"
	"os"
	"strconv"
)

func rawrecv(port int, dest string) (int, error) {
	// TODO(a): ls, err := syscall.Socket(syscall.AF_INET, syscall.SOCK_STREAM, 0)
	//          On error return fmt.Errorf("socket: %w", err). Close ls when rawrecv returns.
	// TODO(b): let the port be reused at once, even if an old connection on it is
	//          still in TIME_WAIT: syscall.SetsockoptInt(ls, syscall.SOL_SOCKET, syscall.SO_REUSEADDR, 1)
	// TODO(c): syscall.Bind(ls, &syscall.SockaddrInet4{Port: port}): no Addr means 0.0.0.0, every address.
	//          On error return fmt.Errorf("bind: %w", err).
	// TODO(d): syscall.Listen(ls, 8). Then fd, _, err := syscall.Accept(ls); close fd when done.
	// TODO(e): open dest (O_WRONLY|O_CREAT|O_TRUNC, 0644) as in rawcopy, then read from fd and
	//          write to the file until Read returns 0. Return the number of bytes.
	return 0, fmt.Errorf("not implemented yet") // delete this line when you are done
}

// writeAll: the one from rawcopy.
func writeAll(fd int, b []byte) error {
	// TODO(f): copy your writeAll from rawcopy.
	return fmt.Errorf("writeAll: not implemented yet") // delete this line when you are done
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
