// slowrecv: accepts one connection on port 9000, waits 8 seconds without reading,
// then reads everything. While it waits, where do the bytes go?
package main

import (
	"fmt"
	"io"
	"net"
	"os"
	"time"
)

func main() {
	ln, err := net.Listen("tcp", ":9000")
	if err != nil {
		fmt.Fprintln(os.Stderr, "slowrecv:", err)
		os.Exit(1)
	}
	conn, err := ln.Accept()
	if err != nil {
		fmt.Fprintln(os.Stderr, "slowrecv:", err)
		os.Exit(1)
	}
	fmt.Println("connected; not reading for 8 seconds")
	time.Sleep(8 * time.Second)
	n, _ := io.Copy(io.Discard, conn)
	fmt.Printf("read %d bytes\n", n)
}
