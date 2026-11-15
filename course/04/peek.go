// peek: a server in non-blocking mode. Instead of waiting in accept and read,
// it asks, gets EAGAIN ("nothing yet, try again"), and does something else.
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
	check(syscall.Listen(ls, 8))
	check(syscall.SetNonblock(ls, true))
	var fd int
	for {
		fd, _, err = syscall.Accept(ls)
		if err == syscall.EAGAIN {
			fmt.Println("accept: nobody yet, doing something else")
			time.Sleep(time.Second)
			continue
		}
		check(err)
		break
	}
	check(syscall.SetNonblock(fd, true))
	buf := make([]byte, 4096)
	for {
		n, err := syscall.Read(fd, buf)
		if err == syscall.EAGAIN {
			fmt.Println("read: no data yet, doing something else")
			time.Sleep(time.Second)
			continue
		}
		check(err)
		if n == 0 {
			fmt.Println("read: the end")
			return
		}
		fmt.Printf("read: %q\n", buf[:n])
	}
}

func check(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, "peek:", err)
		os.Exit(1)
	}
}
