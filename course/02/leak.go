// leak: a bug on purpose. It opens a file again and again and never closes it.
package main

import (
	"fmt"
	"os"
)

func main() {
	var files []*os.File // keeping them stops Go from closing them for us
	for i := 1; ; i++ {
		f, err := os.Open("/etc/hostname")
		if err != nil {
			fmt.Printf("open number %d failed: %v\n", i, err)
			return
		}
		files = append(files, f) // the bug: no f.Close()
	}
}
