// multi: receive from several senders at the same time.
//
//	multi PORT N    listen on PORT, accept N connections, and store connection K
//	                (in the order they are accepted, from 1) in the file in-K.bin.
//	                Each connection is served by its own goroutine, so a slow
//	                sender never holds up a fast one. When connection K ends, print
//	                "K: received B bytes from ADDR". Exit with status 0 when all N
//	                are done; on an error, print "multi: ..." and exit with status 1.
package main

import (
	"fmt"
	"io"
	"net"
	"os"
	"strconv"
	"sync"
)

// handle stores everything conn sends into the file name, then prints the line for k.
func handle(k int, conn net.Conn, name string) error {
	defer conn.Close()
	f, err := os.Create(name)
	if err != nil {
		return err
	}
	defer f.Close()
	n, err := io.Copy(f, conn)
	if err != nil {
		return err
	}
	fmt.Printf("%d: received %d bytes from %s\n", k, n, conn.RemoteAddr())
	return nil
}

// serve accepts n connections and hands each one to its own goroutine.
func serve(port string, n int) error {
	ln, err := net.Listen("tcp", ":"+port)
	if err != nil {
		return err
	}
	defer ln.Close()
	var wg sync.WaitGroup
	for k := 1; k <= n; k++ {
		conn, err := ln.Accept()
		if err != nil {
			return err
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := handle(k, conn, fmt.Sprintf("in-%d.bin", k)); err != nil {
				fmt.Fprintln(os.Stderr, "multi:", err)
			}
		}()
	}
	wg.Wait()
	return nil
}

func main() {
	if len(os.Args) != 3 {
		fmt.Fprintln(os.Stderr, "usage: multi PORT N")
		os.Exit(2)
	}
	n, err := strconv.Atoi(os.Args[2])
	if err != nil || n < 1 {
		fmt.Fprintln(os.Stderr, "multi: N must be a number, at least 1")
		os.Exit(2)
	}
	if err := serve(os.Args[1], n); err != nil {
		fmt.Fprintln(os.Stderr, "multi:", err)
		os.Exit(1)
	}
}
