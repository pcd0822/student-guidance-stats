"""앱 창(pywebview)에 넘기는 객체가 끝없이 따라가지는 속성을 갖지 않는지.

v1.0.2 까지는 창 객체를 공개 속성(window)으로 두어, 윈도우에서 pywebview 가
.NET 객체의 Empty.Empty.… 를 따라가다 maximum recursion depth exceeded 로 멈췄다.
"""
import inspect

from app.__main__ import JsApi


class _Deep:
    """끝없이 새 객체를 내놓는 속성(.NET 의 Size.Empty 같은 것) 흉내"""

    @property
    def Empty(self):
        return _Deep()


def _exposed(obj, base="", seen=None, depth=0):
    """pywebview(webview/util.py get_functions)와 같은 규칙으로 화면에 내보낼 이름을 모은다."""
    seen = seen if seen is not None else set()
    assert depth < 50, "끝없이 따라갑니다: " + base
    if id(obj) in seen:
        return []
    seen.add(id(obj))
    out = []
    for name in dir(obj):
        if name.startswith("_"):
            continue
        attr = getattr(obj, name)
        full = f"{base}.{name}" if base else name
        if inspect.ismethod(attr) or inspect.isfunction(attr):
            out.append(full)
        elif inspect.isclass(attr) or (not callable(attr) and hasattr(attr, "__module__")):
            out += _exposed(attr, full, seen, depth + 1)
    return out


def test_only_functions_are_exposed_even_with_a_deep_window():
    api = JsApi()
    api._window = _Deep()  # 창 자리에 끝없는 객체를 넣어도
    assert sorted(_exposed(api)) == ["open_temp", "reveal", "save_file"]


def test_no_public_data_attributes():
    api = JsApi()
    public = [n for n in vars(api) if not n.startswith("_")]
    assert public == []
