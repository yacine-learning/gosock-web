// chatty: connects and sends 100 bytes, one write per byte.
//
//	chatty ADDR           Go's default: TCP_NODELAY, every write leaves at once
//	chatty -nagle ADDR    with Nagle's algorithm (SetNoDelay(false))
package main

import (
	"fmt"
	"net"
	"os"
)

func main() {
	nagle := len(os.Args) > 2 && os.Args[1] == "-nagle"
	conn, err := net.Dial("tcp", os.Args[len(os.Args)-1])
	if err != nil {
		fmt.Fprintln(os.Stderr, "chatty:", err)
		os.Exit(1)
	}
	if nagle {
		conn.(*net.TCPConn).SetNoDelay(false) // setsockopt(TCP_NODELAY, 0)
	}
	for i := 0; i < 100; i++ {
		conn.Write([]byte{'.'}) // 100 writes of one byte
	}
	conn.Close()
	fmt.Println("100 writes of 1 byte")
}
