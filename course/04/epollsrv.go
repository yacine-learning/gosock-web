// epollsrv: one thread, one loop, any number of clients. epoll tells which
// descriptors are ready; the loop serves exactly those and never blocks on one.
package main

import (
	"fmt"
	"os"
	"syscall"
)

func main() {
	ls, err := syscall.Socket(syscall.AF_INET, syscall.SOCK_STREAM, 0)
	check(err)
	check(syscall.SetsockoptInt(ls, syscall.SOL_SOCKET, syscall.SO_REUSEADDR, 1))
	check(syscall.Bind(ls, &syscall.SockaddrInet4{Port: 9000}))
	check(syscall.Listen(ls, 8))

	ep, err := syscall.EpollCreate1(0) // an epoll instance: one more descriptor
	check(err)
	watch(ep, ls) // "tell me when the listener has a connection"
	fmt.Println("serving on port 9000 with epoll (Ctrl+C to stop)")

	events := make([]syscall.EpollEvent, 16)
	buf := make([]byte, 4096)
	for {
		n, err := syscall.EpollWait(ep, events, -1) // sleep until something is ready
		check(err)
		for _, ev := range events[:n] {
			fd := int(ev.Fd)
			if fd == ls { // a new connection: accept never waits here
				c, _, err := syscall.Accept(ls)
				check(err)
				watch(ep, c)
				fmt.Printf("[%d] connected\n", c)
				continue
			}
			k, err := syscall.Read(fd, buf) // data (or the end): read never waits here
			if err != nil || k == 0 {
				syscall.EpollCtl(ep, syscall.EPOLL_CTL_DEL, fd, nil)
				syscall.Close(fd)
				fmt.Printf("[%d] closed\n", fd)
				continue
			}
			fmt.Printf("[%d] %q\n", fd, buf[:k])
		}
	}
}

// watch registers fd for "readable" events.
func watch(ep, fd int) {
	check(syscall.EpollCtl(ep, syscall.EPOLL_CTL_ADD, fd, &syscall.EpollEvent{Events: syscall.EPOLLIN, Fd: int32(fd)}))
}

func check(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, "epollsrv:", err)
		os.Exit(1)
	}
}
