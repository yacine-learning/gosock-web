// tinyrecv: a receiver with a tiny receive buffer, set with setsockopt before listen
// (accepted sockets inherit it), that reads slowly.
//
//	tinyrecv BYTES    ask for a receive buffer of BYTES, listen on port 9000,
//	                  accept one connection and read it 4 KB every 10 ms
package main

import (
	"fmt"
	"os"
	"strconv"
	"syscall"
	"time"
)

func main() {
	want := 4096
	if len(os.Args) > 1 {
		want, _ = strconv.Atoi(os.Args[1])
	}
	ls, err := syscall.Socket(syscall.AF_INET, syscall.SOCK_STREAM, 0)
	check(err)
	check(syscall.SetsockoptInt(ls, syscall.SOL_SOCKET, syscall.SO_REUSEADDR, 1))
	check(syscall.SetsockoptInt(ls, syscall.SOL_SOCKET, syscall.SO_RCVBUF, want))
	got, err := syscall.GetsockoptInt(ls, syscall.SOL_SOCKET, syscall.SO_RCVBUF)
	check(err)
	fmt.Printf("asked for a %d-byte receive buffer, the kernel gives %d\n", want, got)
	check(syscall.Bind(ls, &syscall.SockaddrInet4{Port: 9000}))
	check(syscall.Listen(ls, 8))
	fd, _, err := syscall.Accept(ls)
	check(err)
	buf, total := make([]byte, 4096), 0
	for {
		n, err := syscall.Read(fd, buf)
		check(err)
		if n == 0 {
			break
		}
		total += n
		time.Sleep(10 * time.Millisecond) // a slow reader
	}
	fmt.Printf("received %d bytes\n", total)
}

func check(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, "tinyrecv:", err)
		os.Exit(1)
	}
}
