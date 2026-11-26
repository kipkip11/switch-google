export class SmartRouter {
  private static COMPLEX_PATTERNS = [
    // Lập trình & Kỹ thuật
    /```[\s\S]*?```/,
    /\b(algorithm|refactor|optimize|architecture|database|mutex|deadlock|concurrency|race condition|memory leak|async|await|pointer|interface|polymorphism|unit test|benchmark)\b/i,
    /\b(lập trình|thuật toán|tối ưu|kiến trúc|cơ sở dữ liệu|bộ nhớ|sửa lỗi|bắt lỗi|ngoại lệ|hàm|lớp|đối tượng)\b/i,
    // Tư duy logic & Suy luận
    /\b(reasoning|step[- ]by[- ]step|prove|proof|deduce|derivation|analyze deeply|chain of thought)\b/i,
    /\b(suy luận|chứng minh|từng bước|phân tích logic|phân tích sâu|tại sao|nguyên nhân gốc|giải thích chi tiết)\b/i
  ];

  public static isSmartModel(modelName: string): boolean {
    const m = modelName.toLowerCase();
    return (
      m.includes('argon') ||
      m.includes('pro') ||
      m.includes('sonnet') ||
      m.includes('opus') ||
      m.includes('r1') ||
      m.includes('reasoning') ||
      m.includes('thinking') ||
      m.includes('o1') ||
      m.includes('o3')
    );
  }

  public static isFastModel(modelName: string): boolean {
    const m = modelName.toLowerCase();
    return (
      m.includes('flash') ||
      m.includes('mini') ||
      m.includes('haiku') ||
      m.includes('nano') ||
      m.includes('turbo')
    );
  }

  public static calculateComplexity(messages: any[], tools?: any[]): { isComplex: boolean; score: number; reason: string } {
    let score = 0;
    const reasons: string[] = [];

    // 1. Phân tích Nội dung tin nhắn gần nhất của người dùng (trọng tâm chính của lượt gọi hiện tại)
    let lastUserMessage = '';
    if (Array.isArray(messages)) {
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg && msg.role === 'user') {
          lastUserMessage = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || '');
          break;
        }
      }
    }

    if (lastUserMessage) {
      let patternMatches = 0;
      for (const pattern of this.COMPLEX_PATTERNS) {
        if (pattern.test(lastUserMessage)) {
          patternMatches++;
        }
      }

      if (patternMatches >= 2) {
        score += 45;
        reasons.push('Chứa mẫu logic & code nâng cao');
      } else if (patternMatches === 1) {
        score += 25;
        reasons.push('Chứa từ khóa kỹ thuật');
      }

      if (lastUserMessage.length > 2500) {
        score += 25;
        reasons.push(`Yêu cầu dài (${lastUserMessage.length} ký tự)`);
      } else if (lastUserMessage.length > 800) {
        score += 15;
      }
    }

    // 2. Phân tích Tools & Lịch sử (chỉ cộng điểm phụ trợ nhỏ vì Agent IDE luôn đính kèm tools)
    if (tools && tools.length > 0 && score > 0) {
      score += 10;
      reasons.push(`${tools.length} Tools`);
    }

    const isComplex = score >= 35;
    return {
      isComplex,
      score,
      reason: reasons.length > 0 ? reasons.join(' + ') : (isComplex ? 'Độ phức tạp cao' : 'Tác vụ thông thường')
    };
  }

  public static prioritizeModels(models: string[], isComplex: boolean): string[] {
    if (!models || models.length === 0) return [];

    const smartModels: string[] = [];
    const fastModels: string[] = [];
    const neutralModels: string[] = [];

    for (const m of models) {
      if (this.isSmartModel(m)) {
        smartModels.push(m);
      } else if (this.isFastModel(m)) {
        fastModels.push(m);
      } else {
        neutralModels.push(m);
      }
    }

    if (isComplex) {
      // Ưu tiên mô hình thông minh / reasoning trước
      return [...smartModels, ...neutralModels, ...fastModels];
    } else {
      // Ưu tiên mô hình tốc độ / tiết kiệm trước
      return [...fastModels, ...neutralModels, ...smartModels];
    }
  }
}
