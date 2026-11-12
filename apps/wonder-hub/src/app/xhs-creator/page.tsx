"use client";

import React, { useState, useRef, useCallback } from 'react';
import { toPng } from 'html-to-image';
import { Download, RefreshCw, Settings, Type, Quote, List, ListOrdered, Eraser, Pilcrow, Upload, FileText } from 'lucide-react';
import { ThemeType, themes } from '@/components/xhs-creator/XhsTheme';
import { XhsCard } from '@/components/xhs-creator/XhsCard';
import { parseXhsMarkdown } from '@/lib/xhs-parser';
import { API_BASE } from '@/lib/api';

const DEFAULT_MARKDOWN = `## 这是一张更适合专业顾问的小红书图

很多内容不是缺少观点，而是缺少一种让读者愿意停下来的呈现方式。

我们可以把一篇长文拆成几张图：

- 第一张给出强观点
- 中间几张解释逻辑
- 最后一张留下行动建议

好的排版不是装饰，而是降低理解成本。

---

## 自动分页与手动分页结合

粘贴文章后，系统会自动提取标题并根据 H2 自动分页。
你仍然可以手动改标题、作者、正文，也可以用三条横线单独分页。

> 好的设计，让每一次分享都有穿透力。`;

const fonts = [
  { id: "'Alibaba PuHuiTi', 'PingFang SC', sans-serif", name: "阿里普惠" },
  { id: "'STKaiti', 'Kaiti', serif", name: "仓耳今楷" },
  { id: "'LXGW WenKai', serif", name: "霞鹜文楷" },
  { id: "system-ui, sans-serif", name: "系统字体" },
];

export default function XhsCreatorPage() {
  const [markdown, setMarkdown] = useState(DEFAULT_MARKDOWN);
  const [theme, setTheme] = useState<ThemeType>('magazine');
  const [fontFamily, setFontFamily] = useState(fonts[3].id);
  const [fontSize, setFontSize] = useState(36);
  const [hasNoise, setHasNoise] = useState(false);
  const [title, setTitle] = useState('小红书精品排版');
  const [author, setAuthor] = useState('Wonder Platform');
  const [teamName, setTeamName] = useState('Wonder Wisdom 出品');
  const [isExporting, setIsExporting] = useState(false);
  const [importUrl, setImportUrl] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isFirstPageCover, setIsFirstPageCover] = useState(true);

  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const pages = parseXhsMarkdown(markdown);

  const insertMarkdown = (prefix: string, suffix: string = '') => {
    if (!textareaRef.current) return;
    const textarea = textareaRef.current;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const selectedText = text.substring(start, end);
    
    const newText = text.substring(0, start) + prefix + selectedText + suffix + text.substring(end);
    setMarkdown(newText);
    
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + prefix.length, end + prefix.length);
    }, 0);
  };

  const handleAIImport = async () => {
    if (!importUrl) {
      alert('请输入文章链接');
      return;
    }
    
    setIsGenerating(true);
    try {
      const response = await fetch(`${API_BASE}/api/xhs-generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: importUrl })
      });
      
      if (!response.ok) throw new Error('AI 生成失败');
      
      const data = await response.json();
      if (data.markdown) {
        setMarkdown(data.markdown);
      }
    } catch (error) {
      console.error(error);
      alert('无法读取该链接或AI生成失败，请重试');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) {
        setMarkdown(event.target.result as string);
      }
    };
    reader.readAsText(file);
  };

  const handleExport = useCallback(async () => {
    if (!containerRef.current || isExporting) return;
    
    try {
      setIsExporting(true);
      
      // Find all card elements inside the container
      const cards = Array.from(containerRef.current.querySelectorAll('.xhs-card-element')) as HTMLElement[];
      
      if (cards.length === 0) return;

      for (let i = 0; i < cards.length; i++) {
        const card = cards[i];
        
        // Wait a bit for fonts and layouts to settle
        await new Promise(r => setTimeout(r, 100));
        
        const dataUrl = await toPng(card, {
          quality: 1,
          pixelRatio: 2, // High DPI export
          cacheBust: true,
        });

        const link = document.createElement('a');
        link.download = `xhs-card-${i + 1}.png`;
        link.href = dataUrl;
        link.click();
        
        // Small delay between downloads to prevent browser blocking
        await new Promise(r => setTimeout(r, 300));
      }
    } catch (err) {
      console.error('Failed to export images:', err);
      alert('导出图片失败，请查看控制台错误');
    } finally {
      setIsExporting(false);
    }
  }, [isExporting]);

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden font-sans">
      
      {/* Left Sidebar - Theme & Settings */}
      <div className="w-72 bg-white border-r border-gray-200 flex flex-col shadow-sm z-10">
        <div className="p-6 border-b border-gray-100">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Settings className="w-5 h-5" />
            排版设置
          </h2>
        </div>
        
        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          {/* Themes */}
          <div>
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">视觉主题</h3>
            <div className="space-y-3">
              {Object.values(themes).map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTheme(t.id as ThemeType)}
                  className={`w-full text-left px-4 py-3 rounded-xl border-2 transition-all ${
                    theme === t.id 
                      ? 'border-blue-600 bg-blue-50/50 shadow-sm' 
                      : 'border-gray-200 hover:border-gray-300 bg-white'
                  }`}
                >
                  <div className="font-medium text-gray-900">{t.name}</div>
                </button>
              ))}
            </div>
          </div>

          <hr className="border-gray-200" />
          
          {/* Import Source */}
          <div>
            <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2 mb-4">
              <span className="w-1.5 h-4 bg-gray-800 rounded-sm inline-block"></span>
              导入来源
            </h3>
            <div className="space-y-4">
              <div className="flex gap-2">
                <input 
                  type="text" 
                  placeholder="粘贴文章链接" 
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  value={importUrl}
                  onChange={(e) => setImportUrl(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAIImport()}
                />
                <button 
                  onClick={handleAIImport}
                  disabled={isGenerating}
                  className="px-3 py-2 bg-[#2b2b2b] text-white rounded-md hover:bg-black transition-colors flex items-center justify-center disabled:opacity-50"
                  title="AI 自动生成文案"
                >
                  {isGenerating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <span className="text-lg leading-none">✨</span>}
                </button>
              </div>

              <div className="relative">
                <input 
                  type="file" 
                  accept=".md,.markdown,.txt" 
                  onChange={handleFileUpload}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" 
                />
                <div className="border border-dashed border-gray-300 rounded-md p-3 text-center hover:bg-gray-50 transition-colors flex items-center justify-center gap-2">
                  <Upload className="w-4 h-4 text-gray-600" />
                  <span className="text-sm text-gray-700">点击或拖入 MD</span>
                </div>
              </div>
              
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <FileText className="w-3.5 h-3.5" />
                <span>支持 .md / .markdown / .txt</span>
              </div>

              <button 
                onClick={() => { setMarkdown(''); setImportUrl(''); }}
                className="w-full py-2 border border-[#d62828] text-[#d62828] rounded-md text-sm hover:bg-red-50 transition-colors flex items-center justify-center gap-2"
              >
                <span className="text-lg leading-none">🗑️</span>
                清除
              </button>
            </div>
          </div>

          <hr className="border-gray-200" />

          {/* Fonts */}
          <div>
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">字体</h3>
            <div className="grid grid-cols-2 gap-2">
              {fonts.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFontFamily(f.id)}
                  className={`px-3 py-2 text-sm rounded-lg border transition-all ${
                    fontFamily === f.id 
                      ? 'border-blue-600 bg-blue-50 text-blue-700 font-medium' 
                      : 'border-gray-200 bg-gray-50 hover:bg-gray-100 text-gray-700'
                  }`}
                >
                  {f.name}
                </button>
              ))}
            </div>
          </div>

          {/* Font Size */}
          <div>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">字体大小</h3>
              <span className="text-xs text-gray-500 font-mono bg-gray-100 px-2 py-1 rounded">{fontSize}px</span>
            </div>
            <input 
              type="range" 
              min="24" max="56" 
              value={fontSize} 
              onChange={(e) => setFontSize(parseInt(e.target.value))}
              className="w-full accent-blue-600"
            />
          </div>

          <hr className="border-gray-200" />

          {/* Background Noise */}
          <label className="flex items-center gap-3 cursor-pointer p-2 hover:bg-gray-50 rounded-lg">
            <input 
              type="checkbox" 
              checked={hasNoise} 
              onChange={(e) => setHasNoise(e.target.checked)}
              className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
            />
            <span className="text-sm font-medium text-gray-700">有一张使用时加背景杂点</span>
          </label>
        </div>
      </div>

      {/* Center - Live Preview */}
      <div className="flex-1 bg-[#f0f2f5] overflow-y-auto relative flex flex-col">
        <div className="sticky top-0 z-20 flex justify-between items-center p-4 bg-[#f0f2f5]/80 backdrop-blur-md border-b border-gray-200/50">
          <div className="text-sm text-gray-500 font-medium">
            实时预览 (共 {pages.length + 1} 张)
          </div>
          <button
            onClick={handleExport}
            disabled={isExporting}
            className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg font-medium shadow-sm transition-colors"
          >
            {isExporting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {isExporting ? '导出中...' : '导出全部图片'}
          </button>
        </div>

        <div className="flex-1 p-8">
          <div 
            ref={containerRef}
            className="flex flex-col items-center space-y-12 pb-24"
          >
            {/* The scale container helps fit the 1080x1440 cards into a standard browser view.
                We apply a scale of 0.4 for viewing, but html-to-image captures the actual size.
                Wait, html-to-image sometimes captures the scaled version if we use CSS transform. 
                Instead, we scale it down via a parent container wrapper, or use a specific technique.
                A better approach is scaling via CSS transform but letting html-to-image capture the raw element.
                Actually, html-to-image handles transform correctly if applied to the parent, or we can temporarily remove transform.
                Let's use a wrapper approach.
             */}
             
            {/* Cover Card */}
            {isFirstPageCover && (
              <div className="xhs-card-wrapper" style={{ transform: 'scale(0.4)', transformOrigin: 'top center', height: 1440 * 0.4 }}>
                <div className="xhs-card-element shadow-2xl">
                  <XhsCard 
                    theme={theme} 
                    teamName={teamName} 
                    content="" 
                    isCover 
                    title={title} 
                    author={author} 
                    fontFamily={fontFamily}
                    fontSize={fontSize}
                    hasNoise={hasNoise}
                  />
                </div>
              </div>
            )}

            {/* Content Cards */}
            {pages.map((pageContent, idx) => (
              <div key={idx} className="xhs-card-wrapper" style={{ transform: 'scale(0.4)', transformOrigin: 'top center', height: 1440 * 0.4 }}>
                <div className="xhs-card-element shadow-2xl">
                  <XhsCard 
                    theme={theme} 
                    teamName={teamName} 
                    content={pageContent} 
                    fontFamily={fontFamily}
                    fontSize={fontSize}
                    hasNoise={hasNoise}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right Sidebar - Content Editor */}
      <div className="w-96 bg-white border-l border-gray-200 flex flex-col shadow-sm z-10">
        <div className="p-6 border-b border-gray-100">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Type className="w-5 h-5" />
            内容编辑
          </h2>
        </div>
        
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <input 
                type="checkbox" 
                id="isFirstPageCover" 
                checked={isFirstPageCover} 
                onChange={(e) => setIsFirstPageCover(e.target.checked)}
                className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
              />
              <label htmlFor="isFirstPageCover" className="text-base font-medium text-gray-800 cursor-pointer">
                第一张使用封面排版
              </label>
            </div>
            
            {isFirstPageCover && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">封面标题</label>
                  <input 
                    type="text" 
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">作者名称</label>
                  <input 
                    type="text" 
                    value={author}
                    onChange={(e) => setAuthor(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </>
            )}
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">页脚团队署名</label>
              <input 
                type="text" 
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <hr className="border-gray-200" />

          <div className="flex-1 flex flex-col h-[500px]">
            <label className="block text-sm font-medium text-gray-700 mb-2 flex justify-between">
              <span>正文 Markdown</span>
              <span className="text-gray-400 font-normal">支持用 --- 分页</span>
            </label>
            
            <div className="flex items-center gap-2 p-3 bg-[#f2ede4] rounded-t-lg border border-b-0 border-[#e6e2d8]">
              <button title="标题 (H2)" onClick={() => insertMarkdown('## ')} className="flex items-center justify-center w-8 h-8 bg-white rounded border border-[#dcd7cb] shadow-sm hover:bg-gray-50 text-gray-700 font-medium text-sm">H4</button>
              <button title="加粗" onClick={() => insertMarkdown('**', '**')} className="flex items-center justify-center w-8 h-8 bg-white rounded border border-[#dcd7cb] shadow-sm hover:bg-gray-50 text-gray-700 font-medium text-sm">B</button>
              <button title="引用" onClick={() => insertMarkdown('> ')} className="flex items-center justify-center w-8 h-8 bg-white rounded border border-[#dcd7cb] shadow-sm hover:bg-gray-50 text-gray-700"><Quote className="w-4 h-4" /></button>
              <div className="w-px h-5 bg-[#dcd7cb] mx-0.5"></div>
              <button title="无序列表" onClick={() => insertMarkdown('- ')} className="flex items-center justify-center w-8 h-8 bg-white rounded border border-[#dcd7cb] shadow-sm hover:bg-gray-50 text-gray-700"><List className="w-4 h-4" /></button>
              <button title="有序列表" onClick={() => insertMarkdown('1. ')} className="flex items-center justify-center w-8 h-8 bg-white rounded border border-[#dcd7cb] shadow-sm hover:bg-gray-50 text-gray-700"><ListOrdered className="w-4 h-4" /></button>
              <button title="清除" onClick={() => {}} className="flex items-center justify-center w-8 h-8 bg-white rounded border border-[#dcd7cb] shadow-sm hover:bg-gray-50 text-gray-700"><Eraser className="w-4 h-4" /></button>
              <button title="段落" onClick={() => insertMarkdown('\n\n')} className="flex items-center justify-center w-8 h-8 bg-white rounded border border-[#dcd7cb] shadow-sm hover:bg-gray-50 text-gray-700"><Pilcrow className="w-4 h-4" /></button>
              <button title="代码/括号" onClick={() => insertMarkdown('[', ']')} className="flex items-center justify-center w-8 h-8 bg-white rounded border border-[#dcd7cb] shadow-sm hover:bg-gray-50 text-gray-700 font-medium text-sm">[ ]</button>
            </div>
            
            <textarea 
              ref={textareaRef}
              className="w-full flex-1 p-4 border border-[#e6e2d8] rounded-b-lg focus:outline-none focus:ring-2 focus:ring-[#8c6b4a] font-mono text-sm resize-none"
              placeholder="在此粘贴文章..."
              value={markdown}
              onChange={(e) => setMarkdown(e.target.value)}
            />
          </div>
        </div>
      </div>

    </div>
  );
}
