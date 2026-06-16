#include <iostream>
#include "tricky.h"

#ifdef USE_DEBUG
#include "debug.h"
#endif

namespace Outer {
    namespace Inner {
        class Worker {
        public:
            void perform() {}
        };
    }
}
