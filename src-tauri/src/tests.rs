// Storage-layer tests. These cover the invariants the collaboration model
// leans on: one file per author, append-only, and de-duplicated assets.
#[cfg(test)]
mod tests {
    use crate::*;
    use std::fs;

    fn tmp(name: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("rc-test-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn comments_dir_is_a_hidden_sibling_of_the_board() {
        let d = tmp("cdir");
        let board = d.join("My Board.canvas");
        let got = comments_dir(board.to_string_lossy().to_string()).unwrap();
        assert_eq!(got, d.join(".My Board.canvas.comments").to_string_lossy());
        assert!(std::path::Path::new(&got).is_dir(), "it should be created on demand");
    }

    #[test]
    fn append_line_creates_then_appends() {
        let d = tmp("append");
        let f = d.join("nested").join("a.jsonl").to_string_lossy().to_string();
        append_line(f.clone(), "{\"id\":\"1\"}".into()).unwrap();
        append_line(f.clone(), "{\"id\":\"2\"}".into()).unwrap();
        let body = fs::read_to_string(&f).unwrap();
        assert_eq!(body, "{\"id\":\"1\"}\n{\"id\":\"2\"}\n");
    }

    #[test]
    fn append_line_never_emits_a_raw_newline() {
        // A stray newline inside a record would split it into two broken lines
        // for every future reader, so it must be escaped on the way in.
        let d = tmp("newline");
        let f = d.join("a.jsonl").to_string_lossy().to_string();
        append_line(f.clone(), "one\ntwo".into()).unwrap();
        let body = fs::read_to_string(&f).unwrap();
        assert_eq!(body.lines().count(), 1);
    }

    #[test]
    fn list_comment_files_finds_only_jsonl_and_is_stable() {
        let d = tmp("list");
        fs::write(d.join("b.jsonl"), "").unwrap();
        fs::write(d.join("a.jsonl"), "").unwrap();
        fs::write(d.join("notes.txt"), "").unwrap();
        let got = list_comment_files(d.to_string_lossy().to_string()).unwrap();
        assert_eq!(got.len(), 2);
        assert!(got[0].ends_with("a.jsonl") && got[1].ends_with("b.jsonl"));
    }

    #[test]
    fn list_comment_files_on_a_missing_folder_is_empty_not_an_error() {
        let got = list_comment_files("/nope/does/not/exist".into()).unwrap();
        assert!(got.is_empty());
    }

    #[test]
    fn read_file_or_empty_tolerates_a_missing_file() {
        assert_eq!(read_file_or_empty("/nope/missing.jsonl".into()).unwrap(), "");
    }

    #[test]
    fn rewrite_lines_compacts_the_file() {
        let d = tmp("compact");
        let f = d.join("a.jsonl").to_string_lossy().to_string();
        append_line(f.clone(), "old1".into()).unwrap();
        append_line(f.clone(), "old2".into()).unwrap();
        rewrite_lines(f.clone(), vec!["only".into()]).unwrap();
        assert_eq!(fs::read_to_string(&f).unwrap(), "only\n");
    }

    #[test]
    fn importing_the_same_file_twice_stores_one_copy() {
        let d = tmp("import");
        let ws = d.join("ws");
        fs::create_dir_all(&ws).unwrap();
        let src = d.join("photo.png");
        fs::write(&src, b"identical bytes").unwrap();

        let a = import_media_hashed(ws.to_string_lossy().into(), src.to_string_lossy().into()).unwrap();
        let b = import_media_hashed(ws.to_string_lossy().into(), src.to_string_lossy().into()).unwrap();
        assert_eq!(a, b, "the same content must resolve to the same asset path");

        let count = fs::read_dir(ws.join(".assets")).unwrap().count();
        assert_eq!(count, 1, "no duplicate on disk");
    }

    #[test]
    fn different_content_gets_a_different_asset() {
        let d = tmp("import2");
        let ws = d.join("ws");
        fs::create_dir_all(&ws).unwrap();
        let one = d.join("a.png");
        let two = d.join("b.png");
        fs::write(&one, b"first").unwrap();
        fs::write(&two, b"second").unwrap();
        let a = import_media_hashed(ws.to_string_lossy().into(), one.to_string_lossy().into()).unwrap();
        let b = import_media_hashed(ws.to_string_lossy().into(), two.to_string_lossy().into()).unwrap();
        assert_ne!(a, b);
        assert!(a.ends_with(".png") && b.ends_with(".png"), "the extension must survive");
    }

    #[test]
    fn write_file_bytes_round_trips_binary() {
        let d = tmp("bytes");
        let f = d.join("out").join("doc.pdf").to_string_lossy().to_string();
        let data = vec![0x25, 0x50, 0x44, 0x46, 0x00, 0xff];
        write_file_bytes(f.clone(), data.clone()).unwrap();
        assert_eq!(fs::read(&f).unwrap(), data);
    }
}
