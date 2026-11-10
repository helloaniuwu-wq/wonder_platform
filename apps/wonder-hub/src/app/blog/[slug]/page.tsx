import Link from "next/link";
import { getAllSlugs, getPostBySlug } from "@/lib/blog";
import { MDXRemote } from "next-mdx-remote/rsc";
import { notFound } from "next/navigation";
import { cookies, headers } from "next/headers";
import { RESTRICTED_CATEGORY } from "@/lib/constants";
import { ArticleLoginGate } from "./ArticleLoginGate";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";

// 微信通行证密钥（与公众号文章链接使用同一 secret）
// 生产环境请移至 .env.local → WECHAT_TOKEN_SECRET
const WECHAT_SECRET = process.env.WECHAT_TOKEN_SECRET ?? "wonder-wechat-2024";

/**
 * 验证微信通行 token（永久有效，无月份限制）
 * 格式: base64url(slug::secret)
 */
function verifyWechatToken(token: string, slug: string): boolean {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf-8");
    // 格式: slug::secret  或旧格式 slug::secret::YYYYMM（兼容旧 token）
    const parts = decoded.split("::");
    const [tSlug, tSecret] = parts;
    return tSlug === slug && tSecret === WECHAT_SECRET;
  } catch {
    return false;
  }
}

// 用于 Next.js 静态导出：预生成所有文章路径
export async function generateStaticParams() {
  const slugs = getAllSlugs();
  return slugs.map((slug) => ({ slug }));
}

// 动态页面 metadata
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) return { title: "文章未找到 | WONDER" };
  return {
    title: `${post.title} | WONDER`,
    description: post.summary,
  };
}

// MDX 自定义组件映射
const mdxComponents = {
  h2: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h2 className="text-3xl font-semibold text-card-foreground mt-16 mb-6 pb-4 border-b border-border/60" {...props} />
  ),
  h3: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h3 className="text-2xl font-semibold text-card-foreground mt-10 mb-4" {...props} />
  ),
  blockquote: (props: React.HTMLAttributes<HTMLQuoteElement>) => (
    <blockquote className="my-8 pl-6 border-l-4 border-primary bg-primary/5 rounded-r-2xl py-5 pr-6 text-foreground/80 italic" {...props} />
  ),
  table: (props: React.HTMLAttributes<HTMLTableElement>) => (
    <div className="my-8 overflow-x-auto rounded-2xl border border-border">
      <table className="w-full text-sm border-collapse" {...props} />
    </div>
  ),
  th: (props: React.HTMLAttributes<HTMLTableCellElement>) => (
    <th className="bg-muted/60 px-6 py-3 text-left font-semibold text-card-foreground border-b border-border text-sm" {...props} />
  ),
  td: (props: React.HTMLAttributes<HTMLTableCellElement>) => (
    <td className="px-6 py-3 border-b border-border/50 text-foreground/80 text-sm" {...props} />
  ),
  p: (props: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p className="text-lg leading-[1.9] text-foreground/85 mb-6" {...props} />
  ),
  ul: (props: React.HTMLAttributes<HTMLUListElement>) => (
    <ul className="my-6 space-y-3 pl-6" {...props} />
  ),
  li: (props: React.HTMLAttributes<HTMLLIElement>) => (
    <li className="text-lg text-foreground/80 leading-relaxed list-disc marker:text-primary" {...props} />
  ),
  strong: (props: React.HTMLAttributes<HTMLElement>) => (
    <strong className="font-semibold text-card-foreground" {...props} />
  ),
  hr: () => <hr className="my-14 border-border/50" />,
  img: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="w-full max-w-full rounded-2xl shadow-md my-8 block"
      alt={props.alt || "图片"}
      {...props}
    />
  ),
};

// 有权阅读受限文章的角色（与 fis-hub / company-admin 一致）
const PRIVILEGED_ROLES = ["admin", "premium", "advisor"];

/**
 * 从 JWT 中解码角色信息（不验证签名，仅解码 payload）
 * 签名验证由后端负责，前端 SSR 仅需判断角色
 */
function decodeJwtRole(token: string): string | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8"));
    return payload.role || null;
  } catch {
    return null;
  }
}

// ─── 访问控制判断 ────────────────────────────────────────────────────────
async function checkAccess(slug: string, searchParams: Record<string, string>): Promise<boolean> {
  // 1. 微信 token（URL 参数 ?wc=TOKEN）→ 永久有效，不看角色
  const wcToken = searchParams["wc"];
  if (wcToken && verifyWechatToken(wcToken, slug)) {
    return true;
  }

  const cookieStore = await cookies();

  // 2. 口令校验（支持不分大小写的 wonder 口令直接解锁）
  const wonderPasscode = cookieStore.get("wonder_passcode")?.value;
  if (wonderPasscode?.toLowerCase() === "wonder") {
    return true;
  }

  // 3. JWT token（cookie 传入）→ 解码 role，仅 admin/premium/advisor 放行
  const jwtCookie = cookieStore.get("token")?.value;
  if (jwtCookie) {
    const role = decodeJwtRole(jwtCookie);
    if (role && PRIVILEGED_ROLES.includes(role)) return true;
    // free 角色已登录但无权 → 不放行
    return false;
  }

  // 3. Authorization header（API 场景）
  const headersList = await headers();
  const authHeader = headersList.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const role = decodeJwtRole(token);
    if (role && PRIVILEGED_ROLES.includes(role)) return true;
    return false;
  }

  return false;
}

// ─── 页面组件 ─────────────────────────────────────────────────────────────
export default async function BlogPost({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const post = getPostBySlug(slug);

  if (!post) notFound();

  // 受限文章访问控制
  const isRestricted = post.restricted || post.category === RESTRICTED_CATEGORY;
  const hasAccess = isRestricted ? await checkAccess(slug, sp) : true;

  // 文章框架（标题/摘要区始终显示）
  const articleHeader = (
    <header className="mb-16">
      <div className="flex flex-wrap gap-2 mb-8">
        {post.tags.map((tag) => (
          <span key={tag} className="text-sm font-medium px-3 py-1.5 rounded-full bg-primary/10 text-primary">
            {tag}
          </span>
        ))}
        {isRestricted && (
          <span className="ml-auto text-xs font-medium px-3 py-1.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
            客户通讯
          </span>
        )}
      </div>
      <h1 className="text-4xl md:text-5xl font-semibold text-card-foreground leading-tight mb-10">
        {post.title}
      </h1>
      <p className="text-xl text-foreground/70 font-light leading-relaxed mb-10 border-l-4 border-primary/30 pl-6">
        {post.summary}
      </p>
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3 py-6 border-t border-b border-border text-sm font-mono text-foreground/50">
        <span className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-primary inline-block" />
          {post.author}
        </span>
        <span>{String(post.date).replace(/-/g, " · ")}</span>
        <span>预计阅读 {post.readingTime} 分钟</span>
      </div>
    </header>
  );

  return (
    <main className="min-h-screen bg-background text-foreground">
      {/* 顶部面包屑 */}
      <div className="border-b border-border bg-card/70 backdrop-blur-md sticky top-16 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/blog" className="text-primary hover:text-primary/70 transition-colors text-base font-medium flex items-center gap-2">
            <span>←</span>
            <span>返回研究列表</span>
          </Link>
          <Link href="/" className="text-foreground/50 hover:text-foreground transition-colors text-sm font-medium">
            WONDER
          </Link>
        </div>
      </div>

      <article
        className="max-w-4xl mx-auto px-6 pt-16 pb-32"
        dir={post.dir || "ltr"}
        lang={post.lang || "zh"}
      >
        {articleHeader}

        {hasAccess ? (
          /* 有权限 → 显示全文 */
          <div className="article-body prose prose-slate max-w-none">
            <MDXRemote
              source={post.content}
              components={mdxComponents}
              options={{
                mdxOptions: {
                  remarkPlugins: [remarkGfm, remarkBreaks],
                },
              }}
            />
          </div>
        ) : (
          /* 无权限 → 显示前 200 字 + 登录门 */
          <>
            <div className="article-body relative">
              <div className="text-lg leading-[1.9] text-foreground/85 mb-6 line-clamp-5">
                {post.content.replace(/[#*`\[\]!]/g, "").slice(0, 300)}...
              </div>
              {/* 渐隐遮罩 */}
              <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-background to-transparent" />
            </div>
            {/* 客户端登录门（需要 client 组件处理 token 刷新）*/}
            <ArticleLoginGate slug={slug} />
          </>
        )}

        <footer className="mt-24 pt-10 border-t border-border">
          <Link href="/blog" className="flex items-center gap-3 text-primary hover:text-primary/70 text-base font-medium transition-colors">
            <span>←</span><span>返回研究列表</span>
          </Link>
        </footer>
      </article>
    </main>
  );
}
