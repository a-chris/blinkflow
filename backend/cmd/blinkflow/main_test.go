package main

import "testing"

// The environment is how a container is configured, so these three readers are
// the whole of the deployment interface: what they return decides which port
// listens and which origin every link claims.

func TestEnvString(t *testing.T) {
	cases := []struct {
		name  string
		set   bool
		value string
		want  string
	}{
		{name: "unset falls back", set: false, want: "loopback"},
		{name: "empty falls back", set: true, value: "", want: "loopback"},
		{name: "value wins", set: true, value: "0.0.0.0", want: "0.0.0.0"},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if testCase.set {
				t.Setenv("BLINKFLOW_TEST_VALUE", testCase.value)
			}
			if got := envString("BLINKFLOW_TEST_VALUE", "loopback"); got != testCase.want {
				t.Fatalf("envString() = %q, want %q", got, testCase.want)
			}
		})
	}
}

func TestEnvInt(t *testing.T) {
	cases := []struct {
		name  string
		set   bool
		value string
		want  int
	}{
		{name: "unset falls back", set: false, want: 8080},
		{name: "empty falls back", set: true, value: "", want: 8080},
		{name: "value wins", set: true, value: "9000", want: 9000},
		{name: "larger than a port is still the operator's choice", set: true, value: "65536", want: 65536},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if testCase.set {
				t.Setenv("BLINKFLOW_TEST_VALUE", testCase.value)
			}
			if got := envInt("BLINKFLOW_TEST_VALUE", 8080); got != testCase.want {
				t.Fatalf("envInt() = %d, want %d", got, testCase.want)
			}
		})
	}
}

func TestEnvBool(t *testing.T) {
	cases := []struct {
		name  string
		set   bool
		value string
		want  bool
	}{
		{name: "unset falls back", set: false, want: true},
		{name: "empty falls back", set: true, value: "", want: true},
		{name: "true wins", set: true, value: "true", want: true},
		{name: "1 is true", set: true, value: "1", want: true},
		{name: "false wins over a true fallback", set: true, value: "false", want: false},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			fallback := true
			if testCase.set {
				t.Setenv("BLINKFLOW_TEST_VALUE", testCase.value)
			}
			if got := envBool("BLINKFLOW_TEST_VALUE", fallback); got != testCase.want {
				t.Fatalf("envBool() = %v, want %v", got, testCase.want)
			}
		})
	}
}
