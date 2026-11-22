// The Rust side (src/lib.rs).
#include <stdint.h>
void ffm_start(void *layer, float width, float height, float scale);
void ffm_frame(void);
void ffm_resize(float width, float height, float scale);
void ffm_touch(uint64_t id, uint8_t phase, float x, float y);
