// gosock-web: replaces Go's fake-network constants for js/wasm with the Linux values,
// so programs written for the simulator read like programs written for Linux.

//go:build js || wasip1

package syscall

const (
	AF_UNSPEC = 0
	AF_UNIX   = 1
	AF_INET   = 2
	AF_INET6  = 10
)

const (
	SOCK_STREAM    = 1
	SOCK_DGRAM     = 2
	SOCK_RAW       = 3
	SOCK_SEQPACKET = 5
	SOCK_NONBLOCK  = 0x800
	SOCK_CLOEXEC   = 0x80000
)

const (
	IPPROTO_IP   = 0
	IPPROTO_IPV4 = 4
	IPPROTO_IPV6 = 0x29
	IPPROTO_TCP  = 6
	IPPROTO_UDP  = 0x11
)

const SOMAXCONN = 4096

const (
	SOL_SOCKET   = 1
	SO_REUSEADDR = 2
	SO_TYPE      = 3
	SO_ERROR     = 4
	SO_SNDBUF    = 7
	SO_RCVBUF    = 8
	SO_KEEPALIVE = 9
	SO_LINGER    = 13
	SO_REUSEPORT = 15
	SO_ACCEPTCONN = 30

	TCP_NODELAY   = 1
	TCP_MAXSEG    = 2
	TCP_CORK      = 3
	TCP_KEEPIDLE  = 4
	TCP_KEEPINTVL = 5
	TCP_KEEPCNT   = 6

	IPV6_V6ONLY = 26

	SHUT_RD   = 0
	SHUT_WR   = 1
	SHUT_RDWR = 2
)

// Misc constants expected by package net but not supported.
const (
	_ = iota
	F_DUPFD_CLOEXEC
	SYS_FCNTL = 500 // unsupported
)

type Sockaddr any

type SockaddrInet4 struct {
	Port int
	Addr [4]byte
}

type SockaddrInet6 struct {
	Port   int
	ZoneId uint32
	Addr   [16]byte
}

type SockaddrUnix struct {
	Name string
}
