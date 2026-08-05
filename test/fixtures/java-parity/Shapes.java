// Java 8 only — declaration/member/type shapes, the other half of the parity
// corpus next to Branches.java. Covers what javalang's whole-tree walk reaches
// and what it deliberately does not.
package parity.shapes;

import java.util.Map;
import static java.util.Collections.emptyList;

@Deprecated
public class Shapes<T extends Number> extends Object implements Cloneable {

    public static final String PUBLIC_CONST = "x";
    public int publicA, publicB;
    private int privateField;
    protected int protectedField;
    int packagePrivateField;

    public Shapes() {
    }

    static {
        int ignored = 1;
    }

    {
        int alsoIgnored = 2;
    }

    @java.lang.Override
    @SuppressWarnings({"unchecked", "rawtypes"})
    public
    java.util.List<String> qualifiedReturn() {
        return null;
    }

    public String[] arrayReturn() {
        return null;
    }

    public int[][] nestedArrayReturn() {
        return null;
    }

    public Map<String, List<Integer>> genericReturn() {
        return null;
    }

    public void voidReturn() {
    }

    public <R> R genericMethod(R input) {
        return input;
    }

    public int varargs(String first, int... rest) {
        return rest.length;
    }

    public abstract static class Abstract {
        public abstract void noBody();
    }

    public static class Inner {
        public static final int INNER_CONST = 1;
        private int hidden;

        public void innerMethod() {
        }

        public static class DeeplyNested {
            public void deep() {
            }

            // Same name as Inner.innerMethod on purpose: exports must dedupe.
            public void innerMethod() {
            }
        }
    }

    public interface InnerInterface {
        int CONSTANT = 1;

        void implicitlyPublic();

        int withParams(int a, String b);
    }

    public enum InnerEnum {
        A,
        B;

        public void enumMethod() {
        }
    }

    public @interface InnerAnnotation {
        String value();
    }
}

interface TopLevelInterface {
    void run();
}

enum TopLevelEnum {
    ONE
}

@interface TopLevelAnnotation {
}
