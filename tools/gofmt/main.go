// gofmt for the editor: exposes gofmt(source) to JavaScript. Built to toolchain/gofmt.wasm.gz.
package main

import (
	"go/format"
	"syscall/js"
)

func main() {
	js.Global().Set("gofmt", js.FuncOf(func(this js.Value, args []js.Value) any {
		out, err := format.Source([]byte(args[0].String()))
		if err != nil {
			return map[string]any{"err": err.Error()}
		}
		return map[string]any{"out": string(out)}
	}))
	select {}
}
