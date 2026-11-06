// 電波がなくても、一度開いたページは開けるようにする（中身は Q のツール共通の oqrn/shared/sw-core.js。CONNEQT_TOOL は Q キットが読む名前なのでそのまま）
// 読まれるところ：index.html の最後で登録する
self.CONNEQT_TOOL = "qumiawase";
importScripts("/oqrn/shared/sw-core.js");
