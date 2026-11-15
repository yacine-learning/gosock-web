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
	"net"
	"os"
	"strconv"
)

// handle stores everything conn sends into the file name, then prints the line for k.
func handle(k int, conn net.Conn, name string) error {
	// TODO(a): close conn when handle returns; create the file name (os.Create) and close it too;
	//          io.Copy(file, conn); then
	//          fmt.Printf("%d: received %d bytes from %s\n", k, n, conn.RemoteAddr())
	return fmt.Errorf("handle: not implemented yet") // delete this line when you are done
}

func serve(port string, n int) error {
	// TODO(b): ln, err := net.Listen("tcp", ":"+port); return the error; close ln at the end.
	// TODO(c): accept n connections in a loop. For connection k (1, 2, ...), start
	//          go handle(k, conn, fmt.Sprintf("in-%d.bin", k)) so the loop can accept the next one.
	// TODO(d): wait for every handler before returning: a sync.WaitGroup (wg.Add(1) before
	//          each go, defer wg.Done() inside the goroutine, wg.Wait() after the loop).
	//          A handler's error: print it as "multi: ..." on standard error.
	return fmt.Errorf("serve: not implemented yet") // delete this line when you are done
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
