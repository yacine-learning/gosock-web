// lazy: a server that listens and never calls accept. What happens to its clients?
package main

import (
	"fmt"
	"os"
	"syscall"
	"time"
)

func main() {
	ls, err := syscall.Socket(syscall.AF_INET, syscall.SOCK_STREAM, 0)
	check(err)
	check(syscall.SetsockoptInt(ls, syscall.SOL_SOCKET, syscall.SO_REUSEADDR, 1))
	check(syscall.Bind(ls, &syscall.SockaddrInet4{Port: 9000}))
	check(syscall.Listen(ls, 2)) // backlog 2
	fmt.Println("listening on port 9000, backlog 2, and never calling accept (Ctrl+C to stop)")
	time.Sleep(time.Hour) // the clients are the kernel's problem now
}

func check(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, "lazy:", err)
		os.Exit(1)
	}
}
