// Java 8 only — javalang 0.13.0 must be able to parse this file, it is the
// oracle for scripts/parser-parity-java.js. Every construct the fingerprint
// walk in parsers/java-ast.js has a rule for appears here at least once.
package parity.branches;

import java.util.List;
import java.util.*;
import static java.lang.Math.max;
import static java.lang.Math.*;

public class Branches {

    public int fallthroughSwitch(int x) {
        switch (x) {
            case 1:
            case 2:
                return 1;
            case 3:
                return 2;
            default:
                return 3;
        }
    }

    public int trailingEmptyLabel(int x) {
        switch (x) {
            case 1:
                break;
            case 2:
            case 3:
        }
        return 0;
    }

    public int nestedSwitch(int x, int y) {
        switch (x) {
            case 1:
                switch (y) {
                    case 10:
                    case 11:
                        break;
                    default:
                        break;
                }
                break;
            default:
                break;
        }
        return 0;
    }

    public int longElseIfChain(int x) {
        if (x == 1) {
            return 1;
        } else if (x == 2) {
            return 2;
        } else if (x == 3) {
            return 3;
        } else {
            return 4;
        }
    }

    public int chainWithoutFinalElse(int x) {
        if (x == 1) {
            return 1;
        } else if (x == 2) {
            return 2;
        }
        return 0;
    }

    public int bareIf(int x) {
        if (x > 0) {
            x++;
        }
        return x;
    }

    public int elseHoldingSingleIf(int x) {
        if (x == 1) {
            return 1;
        } else {
            if (x == 2) {
                return 2;
            }
        }
        return 0;
    }

    public int logicalOperators(int x, int y) {
        boolean a = x > 0 && y > 0 && x < y;
        boolean b = x < 0 || y < 0;
        return (a || b) ? 1 : 0;
    }

    public int allLoops(List<String> items) {
        for (int i = 0; i < 3; i++) {
            i++;
        }
        for (String s : items) {
            s.length();
        }
        int n = 0;
        while (n < 3) {
            n++;
        }
        do {
            n--;
        } while (n > 0);
        return n;
    }

    public void tryShapes() {
        try {
            throwing();
        } catch (IllegalStateException e) {
            e.getMessage();
        } catch (RuntimeException e) {
            e.getMessage();
        } finally {
            throwing();
        }
    }

    public void tryFinallyOnly() {
        try {
            throwing();
        } finally {
            throwing();
        }
    }

    public void multiCatch() {
        try {
            throwing();
        } catch (IllegalStateException | IllegalArgumentException e) {
            e.getMessage();
        }
    }

    public void anonymousClassContributes() {
        Runnable r = new Runnable() {
            @Override
            public void run() {
                if (System.currentTimeMillis() > 0) {
                    throwing();
                }
            }
        };
        r.run();
    }

    public void localClassIsSkipped() {
        class Helper {
            public void help() {
                if (System.currentTimeMillis() > 0) {
                    throwing();
                }
            }
        }
        new Helper().help();
    }

    private void throwing() {
    }

    protected void notExported() {
    }

    void packagePrivate() {
    }
}
