import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { url } = await req.json();
    
    if (!url) {
      return NextResponse.json({ error: '请提供链接' }, { status: 400 });
    }

    // Step 1: Fetch content from the URL
    // We do a simple fetch. Note: this might fail for sites that block fetch or require JS.
    let textContent = '';
    try {
      const pageRes = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      const html = await pageRes.text();
      // Extremely basic HTML text extraction
      textContent = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                        .replace(/<[^>]+>/g, ' ')
                        .replace(/\s+/g, ' ')
                        .slice(0, 10000); // Limit to 10k chars to avoid token explosion
    } catch (e) {
      console.warn("Failed to fetch directly, proceeding assuming it's text:", e);
      // Fallback: maybe the user pasted plain text instead of a URL
      textContent = url.slice(0, 5000);
    }

    // Step 2: Use DeepSeek / OpenRouter API to generate Xiaohongshu text
    const apiKey = process.env.OPENROUTER_API_KEY || '***OPENROUTER_KEY_REDACTED***';
    
    const prompt = `
你是一个顶尖的小红书爆款图文排版专家。请根据以下提取的内容，将其改写/总结成适合用来生成小红书多图卡片（图文排版）的 Markdown 格式文案。

要求：
1. 提取最核心的价值点和情绪价值。
2. 使用 \`## 标题\` 来强制分页（每出现一个 \`## \` 就代表新的一张图片）。
3. 第一张卡片（首页）需要一个极其吸引人的大标题（作为封面）。
4. 中间的内容要用简短有力的句子、无序列表等方式清晰表达。
5. 适度使用金句、引用（> ）。
6. 最后一张卡片留下行动号召（点赞、收藏或评论区讨论）。
7. 输出的内容不要包含任何多余的代码块标记，直接输出纯文本。

内容素材：
${textContent}
`;

    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://wonderwisdom.online',
        'X-Title': 'Wonder Hub'
      },
      body: JSON.stringify({
        model: 'deepseek/deepseek-v4-pro', // 遵循最新 V4 规范的主力模型
        messages: [
          { role: 'system', content: 'You are an expert copywriter for Xiaohongshu.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7,
        // 根据知识库要求，针对 V4 开启可选的思维链控制
        extra_body: {
          thinking: { type: "enabled" },
        }
      })
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error(`AI API failed: ${aiRes.status} - ${errText}`);
      throw new Error(`AI API failed: ${aiRes.status}`);
    }

    const aiData = await aiRes.json();
    const markdown = aiData.choices[0].message.content.replace(/^```markdown\n/, '').replace(/\n```$/, '');

    return NextResponse.json({ markdown });
    
  } catch (error: any) {
    console.error('XHS AI Error:', error.message || error);
    return NextResponse.json({ error: 'AI 生成失败', details: error.message }, { status: 500 });
  }
}
