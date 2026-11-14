// copy: copy a file (or standard input) to standard output. It shows that io.Copy
// does not care whether it reads from a file or from a pipe.
package main

import (
	"fmt"
	"io"
	"os"
)

func main() {
	var src io.Reader = os.Stdin // the default: whatever is piped in
	if len(os.Args) > 1 {
		f, err := os.Open(os.Args[1])
		if err != nil {
			fmt.Fprintln(os.Stderr, "copy:", err)
			os.Exit(1)
		}
		defer f.Close() // runs when main returns
		src = f
	}
	n, err := io.Copy(os.Stdout, src)
	if err != nil {
		fmt.Fprintln(os.Stderr, "copy:", err)
		os.Exit(1)
	}
	fmt.Fprintf(os.Stderr, "copied %d bytes\n", n)
}
