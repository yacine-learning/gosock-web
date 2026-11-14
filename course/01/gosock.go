// gosock: send a file to another machine, or receive one. This first version lets
// Go's standard library do all the socket work.
//
//	gosock recv ADDR DEST     listen on ADDR, accept ONE connection, store what arrives in DEST
//	gosock send ADDR FILE     connect to ADDR and send FILE
package main

import (
	"fmt"
	"os"
)

// recv waits for one sender on addr and writes every byte it sends into the file dest.
// It prints "received N bytes" when the transfer is complete.
func recv(addr, dest string) error {
	// TODO(recv a): start listening for TCP connections on addr (package net, function Listen).
	//               If it fails, return the error. The listener must be closed when recv returns.
	// TODO(recv b): wait for ONE connection (a method of the listener: Accept).
	//               If it fails, return the error. The connection must be closed when recv returns.
	// TODO(recv c): create the file dest (package os, function Create).
	//               If it fails, return the error. The file must be closed when recv returns.
	// TODO(recv d): copy everything that arrives on the connection into the file (package io,
	//               function Copy: it returns how many bytes it copied, and an error).
	//               Then print "received N bytes", where N is that number, and return nil.
	return fmt.Errorf("recv: not implemented yet") // delete this line when you are done
}

// send connects to addr and sends the whole file at path.
// It prints "sent N bytes" when the transfer is complete.
func send(addr, path string) error {
	// TODO(send a): open the file at path for reading (package os, function Open).
	//               If it fails, return the error. The file must be closed when send returns.
	// TODO(send b): connect to addr over TCP (package net, function Dial).
	//               If it fails, return the error. The connection must be closed when send returns.
	// TODO(send c): copy the whole file into the connection (package io, function Copy).
	//               Then print "sent N bytes", where N is the number of bytes copied, and return nil.
	return fmt.Errorf("send: not implemented yet") // delete this line when you are done
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
