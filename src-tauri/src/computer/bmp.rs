//! 24 位 BMP 编码：截图直接落盘为系统自带查看器可打开的格式，不引入图片编解码依赖。

/// 每行像素字节数按 4 字节对齐，与 GetDIBits 输出的 24 位 DIB 行宽一致
pub fn row_stride(width: u32) -> usize {
    (width as usize * 3).div_ceil(4) * 4
}

/// `pixels` 为自下而上排列、行宽按 `row_stride` 对齐的 BGR 数据
pub fn encode_bmp(width: u32, height: u32, pixels: &[u8]) -> Result<Vec<u8>, String> {
    let expected = row_stride(width) * height as usize;
    if pixels.len() != expected {
        return Err(format!("像素数据长度 {} 与 {}x{} 不符（应为 {}）", pixels.len(), width, height, expected));
    }
    const HEADER_LEN: u32 = 14 + 40;
    let file_len = HEADER_LEN + expected as u32;
    let mut out = Vec::with_capacity(file_len as usize);
    out.extend_from_slice(b"BM");
    out.extend_from_slice(&file_len.to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes());
    out.extend_from_slice(&HEADER_LEN.to_le_bytes());
    out.extend_from_slice(&40u32.to_le_bytes());
    out.extend_from_slice(&(width as i32).to_le_bytes());
    out.extend_from_slice(&(height as i32).to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&24u16.to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes());
    out.extend_from_slice(&(expected as u32).to_le_bytes());
    // 96 DPI 对应的每米像素数
    out.extend_from_slice(&3780i32.to_le_bytes());
    out.extend_from_slice(&3780i32.to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes());
    out.extend_from_slice(pixels);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pads_rows_to_four_bytes() {
        assert_eq!(row_stride(1), 4);
        assert_eq!(row_stride(4), 12);
        assert_eq!(row_stride(5), 16);
    }

    #[test]
    fn writes_bitmap_headers() {
        let pixels = vec![0u8; row_stride(3) * 2];
        let bmp = encode_bmp(3, 2, &pixels).unwrap();
        assert_eq!(&bmp[0..2], b"BM");
        assert_eq!(u32::from_le_bytes(bmp[2..6].try_into().unwrap()) as usize, bmp.len());
        assert_eq!(u32::from_le_bytes(bmp[10..14].try_into().unwrap()), 54);
        assert_eq!(i32::from_le_bytes(bmp[18..22].try_into().unwrap()), 3);
        assert_eq!(i32::from_le_bytes(bmp[22..26].try_into().unwrap()), 2);
        assert_eq!(u16::from_le_bytes(bmp[28..30].try_into().unwrap()), 24);
        assert!(encode_bmp(3, 2, &pixels[1..]).is_err());
    }
}
