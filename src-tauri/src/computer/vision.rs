//! look 工具的图像处理：把截图缩放到模型友好的尺寸、编码为 PNG，并记录图像与屏幕坐标的换算关系，
//! 让模型直接用图上坐标点击，不需要自己做缩放换算。

use base64::Engine;
use std::sync::Mutex;

/// 送给模型的截图长边上限：1280 像素在各家视觉模型上约一千多 token，界面文字与图标仍清晰可辨
pub const MAX_IMAGE_EDGE: u32 = 1280;

/// 工具输出中携带图片的标记：执行层把图片放在输出开头，Agent 循环取出后作为图片消息交给模型，
/// 文本部分照常回填，图片不会进入工具卡片预览或溢出文件
const IMAGE_MARKER_START: &str = "<<yachiyo-image:";
const IMAGE_MARKER_END: &str = ">>\n";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CaptureMapping {
    pub left: i32,
    pub top: i32,
    pub width: u32,
    pub height: u32,
    pub image_width: u32,
    pub image_height: u32,
}

impl CaptureMapping {
    /// 图上坐标换算为屏幕物理像素坐标；越出图片范围时返回 None
    pub fn to_screen(&self, image_x: f64, image_y: f64) -> Option<(i32, i32)> {
        if !(0.0..self.image_width as f64).contains(&image_x) || !(0.0..self.image_height as f64).contains(&image_y) {
            return None;
        }
        let x = self.left as f64 + (image_x + 0.5) * self.width as f64 / self.image_width as f64;
        let y = self.top as f64 + (image_y + 0.5) * self.height as f64 / self.image_height as f64;
        Some((x.floor() as i32, y.floor() as i32))
    }
}

static LAST_CAPTURE: Mutex<Option<CaptureMapping>> = Mutex::new(None);

pub fn remember_capture(mapping: CaptureMapping) {
    *LAST_CAPTURE.lock().unwrap() = Some(mapping);
}

pub fn last_capture() -> Option<CaptureMapping> {
    *LAST_CAPTURE.lock().unwrap()
}

/// 保持宽高比把长边缩到 `max_edge` 以内（不放大）
pub fn fit_size(width: u32, height: u32, max_edge: u32) -> (u32, u32) {
    let longest = width.max(height);
    if longest <= max_edge || longest == 0 {
        return (width.max(1), height.max(1));
    }
    let scale = max_edge as f64 / longest as f64;
    (((width as f64 * scale).round() as u32).max(1), ((height as f64 * scale).round() as u32).max(1))
}

/// 区域平均缩放：输入为 GetDIBits 的 24 位 BGR、自下而上、行宽按 4 字节对齐；
/// 输出为自上而下、紧密排列的 RGB，可直接交给 PNG 编码
pub fn downscale_bgr_bottom_up(pixels: &[u8], width: u32, height: u32, stride: usize, target: (u32, u32)) -> Vec<u8> {
    let (target_w, target_h) = target;
    let mut out = Vec::with_capacity(target_w as usize * target_h as usize * 3);
    for ty in 0..target_h {
        let y0 = (ty as u64 * height as u64 / target_h as u64) as u32;
        let y1 = (((ty as u64 + 1) * height as u64).div_ceil(target_h as u64) as u32).clamp(y0 + 1, height);
        for tx in 0..target_w {
            let x0 = (tx as u64 * width as u64 / target_w as u64) as u32;
            let x1 = (((tx as u64 + 1) * width as u64).div_ceil(target_w as u64) as u32).clamp(x0 + 1, width);
            let mut sum = [0u64; 3];
            for sy in y0..y1 {
                // DIB 自下而上存放，第 sy 行（自上而下）在缓冲区中的位置
                let row = (height - 1 - sy) as usize * stride;
                for sx in x0..x1 {
                    let index = row + sx as usize * 3;
                    sum[0] += pixels[index + 2] as u64;
                    sum[1] += pixels[index + 1] as u64;
                    sum[2] += pixels[index] as u64;
                }
            }
            let count = ((y1 - y0) * (x1 - x0)) as u64;
            out.extend(sum.iter().map(|channel| (channel / count) as u8));
        }
    }
    out
}

pub fn encode_png(rgb: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut out, width, height);
        encoder.set_color(png::ColorType::Rgb);
        encoder.set_depth(png::BitDepth::Eight);
        encoder.set_compression(png::Compression::Fast);
        let mut writer = encoder.write_header().map_err(|e| format!("PNG 编码失败: {}", e))?;
        writer.write_image_data(rgb).map_err(|e| format!("PNG 编码失败: {}", e))?;
    }
    Ok(out)
}

pub fn png_data_url(png: &[u8]) -> String {
    format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(png))
}

pub fn attach_image(data_url: &str, text: &str) -> String {
    format!("{IMAGE_MARKER_START}{data_url}{IMAGE_MARKER_END}{text}")
}

/// 拆出工具输出开头携带的图片；没有标记时原样返回文本
pub fn split_image_output(output: String) -> (String, Option<String>) {
    let Some(rest) = output.strip_prefix(IMAGE_MARKER_START) else {
        return (output, None);
    };
    match rest.split_once(IMAGE_MARKER_END) {
        Some((image, text)) => (text.to_string(), Some(image.to_string())),
        None => (output, None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fits_long_edge_without_upscaling() {
        assert_eq!(fit_size(2560, 1440, 1280), (1280, 720));
        assert_eq!(fit_size(1440, 2560, 1280), (720, 1280));
        assert_eq!(fit_size(800, 600, 1280), (800, 600));
    }

    #[test]
    fn maps_image_points_back_to_screen() {
        let mapping = CaptureMapping { left: 100, top: 50, width: 2000, height: 1000, image_width: 1000, image_height: 500 };
        assert_eq!(mapping.to_screen(0.0, 0.0), Some((101, 51)));
        assert_eq!(mapping.to_screen(500.0, 250.0), Some((1101, 551)));
        assert_eq!(mapping.to_screen(1000.0, 10.0), None);
        assert_eq!(mapping.to_screen(-1.0, 10.0), None);
    }

    #[test]
    fn downscales_bottom_up_bgr_into_top_down_rgb() {
        // 2x2 图：上排红、下排蓝（DIB 自下而上存放，先写下排）
        let stride = 8;
        let mut pixels = vec![0u8; stride * 2];
        pixels[0..6].copy_from_slice(&[255, 0, 0, 255, 0, 0]);
        pixels[8..14].copy_from_slice(&[0, 0, 255, 0, 0, 255]);
        assert_eq!(downscale_bgr_bottom_up(&pixels, 2, 2, stride, (2, 2)), vec![255, 0, 0, 255, 0, 0, 0, 0, 255, 0, 0, 255]);
        assert_eq!(downscale_bgr_bottom_up(&pixels, 2, 2, stride, (1, 1)), vec![127, 0, 127]);
    }

    #[test]
    fn round_trips_image_marker() {
        let output = attach_image("data:image/png;base64,AAAA", "已截取前台窗口");
        assert_eq!(
            split_image_output(output),
            ("已截取前台窗口".to_string(), Some("data:image/png;base64,AAAA".to_string()))
        );
        assert_eq!(split_image_output("普通输出".to_string()), ("普通输出".to_string(), None));
    }

    #[test]
    fn encodes_png_signature() {
        let png = encode_png(&[0, 0, 0, 255, 255, 255], 2, 1).unwrap();
        assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
    }
}
