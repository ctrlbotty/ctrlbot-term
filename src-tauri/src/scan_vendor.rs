use std::{collections::HashMap, sync::OnceLock};

/// Offline IEEE lookup. More-specific MA-S/IAB and MA-M blocks win over MA-L.
/// Locally administered/randomized MACs do not establish a manufacturer.
pub fn lookup(mac: &str) -> Option<String> {
    static VENDORS: OnceLock<HashMap<&'static str, &'static str>> = OnceLock::new();
    let key: String = mac
        .chars()
        .filter(|c| *c != ':' && *c != '-')
        .collect::<String>()
        .to_ascii_uppercase();
    if key.len() != 12 || !key.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let first = u8::from_str_radix(&key[..2], 16).ok()?;
    if first & 3 != 0 {
        return None;
    }
    let vendors = VENDORS.get_or_init(|| {
        include_str!("../data/mac-vendors.tsv")
            .lines()
            .filter(|line| !line.starts_with('#'))
            .filter_map(|line| line.split_once('\t'))
            .collect()
    });
    [9, 7, 6].into_iter().find_map(|length| {
        vendors
            .get(&key[..length])
            .map(|value| (*value).to_string())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn known_network_vendors_and_private_addresses() {
        assert!(lookup("B8:98:B0:05:94:15")
            .unwrap()
            .to_lowercase()
            .contains("atlona"));
        assert!(lookup("38:42:0B:1F:5C:AC")
            .unwrap()
            .to_lowercase()
            .contains("sonos"));
        assert!(lookup("A4:13:4E:EF:51:76")
            .unwrap()
            .to_lowercase()
            .contains("luxul"));
        assert!(lookup("B6:E4:CE:97:B7:80").is_none());
        assert!(lookup("FF:FF:FF:FF:FF:FF").is_none());
        assert!(lookup("bad").is_none());
    }
}
