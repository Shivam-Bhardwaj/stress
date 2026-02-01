CXX = g++
CXXFLAGS = -O2 -std=c++20 -Wall
SRCS = main.cpp math_lib.cpp container_lib.cpp string_lib.cpp
OBJS = $(SRCS:.cpp=.o)
TARGET = compile_bench

all: $(TARGET)

$(TARGET): $(OBJS)
	$(CXX) $(CXXFLAGS) -o $@ $^

%.o: %.cpp
	$(CXX) $(CXXFLAGS) -c $< -o $@

main.o: math_lib.hpp container_lib.hpp string_lib.hpp
math_lib.o: math_lib.hpp
container_lib.o: container_lib.hpp
string_lib.o: string_lib.hpp

clean:
	rm -f $(OBJS) $(TARGET)

.PHONY: all clean
