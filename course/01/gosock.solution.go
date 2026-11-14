// gosock: send a file to another machine, or receive one. This first version lets
// Go's standard library do all the socket work.
//
//	gosock recv ADDR DEST     listen on ADDR, accept ONE connection, store what arrives in DEST
//	gosock send ADDR FILE     connect to ADDR and send FILE
package main

import (
	"fmt"
	"io"
	"net"
	"os"
)

// recv waits for one sender on addr and writes every byte it sends into the file dest.
// It prints "received N bytes" when the transfer is complete.
func recv(addr, dest string) error {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	defer ln.Close()

	conn, err := ln.Accept()
	if err != nil {
		return err
	}
	defer conn.Close()

	f, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer f.Close()

	n, err := io.Copy(f, conn)
	if err != nil {
		return err
	}
	fmt.Printf("received %d bytes\n", n)
	return nil
}

// send connects to addr and sends the whole file at path.
// It prints "sent N bytes" when the transfer is complete.
func send(addr, path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()

	conn, err := net.Dial("tcp", addr)
	if err != nil {
		return err
	}
	defer conn.Close()

	n, err := io.Copy(conn, f)
	if err != nil {
		return err
	}
	fmt.Printf("sent %d bytes\n", n)
	return nil
}

func main() {
	var err error
	switch {
	case len(os.Args) == 4 && os.Args[1] == "recv":
		err = recv(os.Args[2], os.Args[3])
	case len(os.Args) == 4 && os.Args[1] == "send":
		err = send(os.Args[2], os.Args[3])
	default:
		fmt.Fprintln(os.Stderr, "usage: gosock recv ADDR DEST | gosock send ADDR FILE")
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "gosock:", err)
		os.Exit(1)
	}
}
