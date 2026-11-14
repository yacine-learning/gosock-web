// once: a server that greets ONE client and closes the connection first.
//
//	once           listen on port 9000 WITHOUT SO_REUSEADDR (the bug)
//	once -reuse    with SO_REUSEADDR (the fix)
package main

import (
	"fmt"
	"os"
	"syscall"
)

func main() {
	reuse := len(os.Args) > 1 && os.Args[1] == "-reuse"
	ls, err := syscall.Socket(syscall.AF_INET, syscall.SOCK_STREAM, 0)
	check("socket", err)
	if reuse {
		check("setsockopt", syscall.SetsockoptInt(ls, syscall.SOL_SOCKET, syscall.SO_REUSEADDR, 1))
	}
	check("bind", syscall.Bind(ls, &syscall.SockaddrInet4{Port: 9000}))
	check("listen", syscall.Listen(ls, 8))
	fd, _, err := syscall.Accept(ls)
	check("accept", err)
	syscall.Write(fd, []byte("hello from once\n"))
	syscall.Close(fd) // the server closes first: its side of the connection will wait in TIME_WAIT
	syscall.Close(ls)
	fmt.Println("greeted one client, closed first")
}

func check(what string, err error) {
	if err != nil {
		fmt.Fprintf(os.Stderr, "once: %s: %v\n", what, err)
		os.Exit(1)
	}
}
