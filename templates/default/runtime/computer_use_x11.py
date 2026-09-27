"""Container-local X11/XTEST bindings. No host devices, shell, clipboard or network."""
import ctypes as C


class X11:
    def __init__(self):
        self.lib = C.CDLL('libX11.so.6')
        self.test = C.CDLL('libXtst.so.6')
        P, I, U, L = C.c_void_p, C.c_int, C.c_uint, C.c_ulong
        signatures = {
            'XOpenDisplay': ([C.c_char_p], P), 'XDefaultRootWindow': ([P], L),
            'XDefaultScreen': ([P], I), 'XDisplayWidth': ([P, I], I), 'XDisplayHeight': ([P, I], I),
            'XQueryPointer': ([P, L, C.POINTER(L), C.POINTER(L), C.POINTER(I), C.POINTER(I), C.POINTER(I), C.POINTER(I), C.POINTER(U)], I),
            'XStringToKeysym': ([C.c_char_p], L), 'XKeysymToKeycode': ([P, L], C.c_ubyte),
            'XSync': ([P, I], I), 'XDisplayKeycodes': ([P, C.POINTER(I), C.POINTER(I)], I),
            'XGetKeyboardMapping': ([P, C.c_ubyte, I, C.POINTER(I)], C.POINTER(L)),
            'XChangeKeyboardMapping': ([P, I, I, C.POINTER(L), I], I), 'XFree': ([P], I),
        }
        for name, (args, result) in signatures.items():
            fn = getattr(self.lib, name)
            fn.argtypes, fn.restype = args, result
        for name, args in {'XTestFakeMotionEvent': [P, I, I, I, L], 'XTestFakeButtonEvent': [P, U, I, L], 'XTestFakeKeyEvent': [P, U, I, L]}.items():
            fn = getattr(self.test, name)
            fn.argtypes, fn.restype = args, I
        self.display = self.lib.XOpenDisplay(b':1')
        if not self.display:
            raise RuntimeError('Guest X11 display is unavailable.')
        self.root = self.lib.XDefaultRootWindow(self.display)
        self.screen = self.lib.XDefaultScreen(self.display)

    def sync(self):
        self.lib.XSync(self.display, 0)

    def state(self):
        root, child = C.c_ulong(), C.c_ulong()
        x, y, wx, wy, mask = C.c_int(), C.c_int(), C.c_int(), C.c_int(), C.c_uint()
        if not self.lib.XQueryPointer(self.display, self.root, C.byref(root), C.byref(child), C.byref(x), C.byref(y), C.byref(wx), C.byref(wy), C.byref(mask)):
            raise RuntimeError('Cannot read current guest pointer.')
        return (self.lib.XDisplayWidth(self.display, self.screen), self.lib.XDisplayHeight(self.display, self.screen), x.value, y.value)

    def keycode(self, name):
        code = self.lib.XKeysymToKeycode(self.display, self.lib.XStringToKeysym(name.encode('ascii')))
        if not code:
            raise ValueError(f'Key {name} is unavailable in the guest layout.')
        return code

    def move(self, x, y):
        if not self.test.XTestFakeMotionEvent(self.display, self.screen, x, y, 0):
            raise RuntimeError('Guest pointer input failed.')
        self.sync()

    def transition(self, device, code, down):
        fn = self.test.XTestFakeKeyEvent if device == 'keys' else self.test.XTestFakeButtonEvent
        if not fn(self.display, code, int(down), 0):
            raise RuntimeError('Guest input failed.')
        self.sync()

    def spare_mapping(self):
        low, high, count = C.c_int(), C.c_int(), C.c_int()
        self.lib.XDisplayKeycodes(self.display, C.byref(low), C.byref(high))
        size = high.value - low.value + 1
        mapping = self.lib.XGetKeyboardMapping(self.display, low.value, size, C.byref(count))
        if not mapping:
            raise RuntimeError('Cannot inspect guest key map.')
        try:
            for code in range(high.value, low.value - 1, -1):
                row = [int(mapping[(code - low.value)*count.value + j]) for j in range(count.value)]
                if not any(row):
                    return {'code': code, 'symbols': row}
        finally:
            self.lib.XFree(mapping)
        raise ValueError('No unused guest keycode is available for Unicode typing.')

    def mapping(self, code, symbols):
        data = (C.c_ulong * len(symbols))(*symbols)
        self.lib.XChangeKeyboardMapping(self.display, code, len(symbols), data, 1)
        self.sync()
