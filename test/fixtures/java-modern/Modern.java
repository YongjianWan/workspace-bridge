// Java 14+ syntax. javalang 0.13.0 (2020) fails this whole file, which is why
// it has no parity oracle — expected output is locked by
// test/java-modern-syntax-test.js instead. Keep this file OUT of
// test/fixtures/java-parity: that directory is the oracle-comparable corpus.
package modern.demo;

import java.util.List;

public record Point(int x, int y) {

    public int sum() {
        return x + y;
    }

    public Point scaled(int factor) {
        return new Point(x * factor, y * factor);
    }
}

sealed interface Shape permits Circle, Square {
    double area();
}

record Circle(double radius) implements Shape {
    public double area() {
        return Math.PI * radius * radius;
    }
}

record Square(double side) implements Shape {
    public double area() {
        return side * side;
    }
}

class ModernFeatures {

    public String textBlock() {
        return """
            {
              "hello": "world"
            }
            """;
    }

    public int switchExpressionArrow(int day) {
        return switch (day) {
            case 1, 2, 3, 4, 5 -> 1;
            case 6, 7 -> 2;
            default -> 0;
        };
    }

    public int switchExpressionYield(int day) {
        return switch (day) {
            case 1 -> {
                yield 10;
            }
            default -> {
                yield 20;
            }
        };
    }

    public String instanceofPattern(Object o) {
        if (o instanceof String s && s.length() > 3) {
            return s;
        }
        return "";
    }

    public String varLocal(List<String> items) {
        var first = items.get(0);
        for (var item : items) {
            first = item;
        }
        return first;
    }
}
