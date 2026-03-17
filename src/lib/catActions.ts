export const CAT_ACTIONS = [
  "左右乱摆尾巴",
  "急速甩/乱晃尾巴",
  "缓慢摆动尾巴",
  "尾巴平/微弯向下、尾尖朝上",
  "尾巴略提起，柔软弯曲",
  "尾巴竖起、尾尖弯曲",
  "尾巴竖起、尾尖竖直",
  "尾巴完全垂下、夹在两腿间",
  "尾巴向下、炸毛竖起",
  "尾巴强烈左右摆动",
  "尾尖震动",
  "尾巴竖起并摆动",
  "趴着尾巴放在一边",
  "胡须自然向前/略微向两侧展开",
  "胡须向后紧贴脸部伴随耳朵后倾",
  "弓背",
  "缓慢眨眼",
  "嘴巴微张",
  "蹭人、蹭物件",
  "轻咬或抓挠",
  "打滚露肚皮"
];

// Expanded keywords for robust matching
// This handles cases where the model might output only part of a slash-separated action
// or slightly different phrasing that still strictly matches the intent.
export const ACTION_KEYWORDS = [
  "左右乱摆尾巴",
  "急速甩", "乱晃尾巴",
  "缓慢摆动尾巴",
  "尾巴平", "微弯向下", "尾尖朝上",
  "尾巴略提起", "柔软弯曲",
  "尾巴竖起", "尾尖弯曲",
  "尾尖竖直",
  "尾巴完全垂下", "夹在两腿间",
  "尾巴向下", "炸毛竖起",
  "尾巴强烈左右摆动",
  "尾尖震动",
  "尾巴竖起并摆动",
  "趴着尾巴",
  "胡须自然向前", "略微向两侧展开",
  "胡须向后紧贴", "耳朵后倾",
  "弓背",
  "缓慢眨眼", "猫吻",
  "嘴巴微张", "Flehmen",
  "蹭人", "蹭物件",
  "轻咬", "抓挠",
  "打滚露肚皮"
];

export const isCatAction = (text: string): string | null => {
  for (const keyword of ACTION_KEYWORDS) {
    if (text.includes(keyword)) {
      return keyword;
    }
  }
  return null;
};
