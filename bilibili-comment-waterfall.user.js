// ==UserScript==
// @name         Bilibili评论展开助手
// @namespace    http://tampermonkey.net/
// @version      2.5.0
// @description  智能展开Bilibili评论回复，一键查看所有子评论，支持按热度和时间排序，完整支持B站表情符号显示，提供流畅的评论浏览体验
// @author       Rygtx
// @icon         https://www.bilibili.com/favicon.ico
// @match        https://www.bilibili.com/video/*
// @grant        none
// @license      CC-BY-NC-4.0
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    // 配置常量
    const CONFIG = {
        API_BASE: 'https://api.bilibili.com',
        COMMENT_TYPE: 1, // 视频评论类型
        MAX_RETRIES: 3,
        RETRY_DELAY: 1000,
        REQUEST_TIMEOUT: 10000,
        REPLY_PAGE_SIZE: 20, // 单页回复数，接口通常会限制最大值
        REPLY_MAX_PAGES: 100, // 回复最大抓取页数，100*20=2000
        REPLY_FETCH_CONCURRENCY: 10 // 回复抓取并发数
    };

    // 工具函数
    const Utils = {
        // 调试日志输出功能
        log(level, message, ...args) {
            const timestamp = new Date().toISOString();
            const prefix = `[Bilibili评论展开助手 ${timestamp}]`;

            switch (level) {
                case 'error':
                    console.error(prefix, message, ...args);
                    break;
                case 'warn':
                    console.warn(prefix, message, ...args);
                    break;
                case 'info':
                    console.info(prefix, message, ...args);
                    break;
                default:
                    console.log(prefix, message, ...args);
            }
        },

        formatTime(timestamp) {
            if (!timestamp) return '未知时间';

            const date = new Date(timestamp * 1000);
            const now = new Date();
            const diff = now - date;

            const minute = 60 * 1000;
            const hour = 60 * minute;
            const day = 24 * hour;
            const month = 30 * day;
            const year = 365 * day;

            if (diff < minute) {
                return '刚刚';
            } else if (diff < hour) {
                return `${Math.floor(diff / minute)}分钟前`;
            } else if (diff < day) {
                return `${Math.floor(diff / hour)}小时前`;
            } else if (diff < month) {
                return `${Math.floor(diff / day)}天前`;
            } else if (diff < year) {
                return `${Math.floor(diff / month)}个月前`;
            } else {
                return `${Math.floor(diff / year)}年前`;
            }
        },

        formatDetailedTime(timestamp) {
            if (!timestamp) return '未知时间';

            const date = new Date(timestamp * 1000);
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const hours = String(date.getHours()).padStart(2, '0');
            const minutes = String(date.getMinutes()).padStart(2, '0');
            const seconds = String(date.getSeconds()).padStart(2, '0');

            return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
        },

        // HTML转义工具函数
        escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        },

        // 表情处理：仅使用当前回复自带 emote 映射

        normalizeEmoticonUrl(url) {
            if (!url || typeof url !== 'string') return null;
            const normalizedUrl = url.trim();
            if (!normalizedUrl) return null;
            if (normalizedUrl.startsWith('//')) return `https:${normalizedUrl}`;
            if (/^https?:\/\//i.test(normalizedUrl)) return normalizedUrl;
            if (normalizedUrl.startsWith('/')) return `https://www.bilibili.com${normalizedUrl}`;
            return null;
        },

        extractEmoticonUrl(emote) {
            if (!emote) return null;
            if (typeof emote === 'string') {
                return this.normalizeEmoticonUrl(emote);
            }

            const candidates = [
                emote.url,
                emote.jump_url,
                emote.webp,
                emote.gif,
                emote.image,
                emote.icon,
                emote.dynamic_url,
                emote.static_url,
                emote?.meta?.url,
                emote?.meta?.jump_url
            ];

            for (const candidate of candidates) {
                const normalized = this.normalizeEmoticonUrl(candidate);
                if (normalized) {
                    return normalized;
                }
            }

            return null;
        },

        // 从当前回复中提取原生表情映射
        buildReplyEmoticonMap(replyEmoteData) {
            const map = {};
            if (!replyEmoteData || typeof replyEmoteData !== 'object') {
                return map;
            }

            for (const [rawKey, emote] of Object.entries(replyEmoteData)) {
                const imageUrl = this.extractEmoticonUrl(emote);
                if (!imageUrl) continue;

                const keys = new Set();
                if (typeof rawKey === 'string' && rawKey.trim()) {
                    keys.add(rawKey.trim());
                }
                if (typeof emote?.text === 'string' && emote.text.trim()) {
                    keys.add(emote.text.trim());
                }

                keys.forEach(key => {
                    const cleanKey = key.replace(/^\[/, '').replace(/\]$/, '');
                    const fullEmoticon = `[${cleanKey}]`;
                    map[fullEmoticon] = imageUrl;
                });
            }

            return map;
        },

        // 处理B站表情符号 - 仅使用回复自带映射
        processEmoticons(content, replyEmoteData = null) {
            if (!content) return content;

            const emoticonPattern = /\[([^\]]+)\]/g;
            const replyEmoticonMap = this.buildReplyEmoticonMap(replyEmoteData);
            if (Object.keys(replyEmoticonMap).length === 0) return content;

            let processedContent = content;
            let replacedCount = 0;

            processedContent = processedContent.replace(emoticonPattern, (match, emoticonName) => {
                const fullEmoticon = `[${emoticonName}]`;
                const imageUrl = replyEmoticonMap[fullEmoticon];

                if (imageUrl) {
                    replacedCount++;
                    // 使用与B站原生完全一致的HTML结构和样式
                    return `<img class="emoji" src="${imageUrl}" alt="${fullEmoticon}" title="${fullEmoticon}" style="width: 20px; height: 20px; vertical-align: text-bottom; margin: 0 1px; display: inline-block; object-fit: contain;" loading="lazy">`;
                }

                // 如果没有找到对应的表情，保持原文本
                return match;
            });

            if (replacedCount > 0) {
                this.log('info', `处理了 ${replacedCount} 个表情符号`);
            }

            return processedContent;
        },

        // 获取视频标题
        async getVideoTitle(videoId, isAv = false) {
            try {
                let apiUrl;
                if (isAv) {
                    apiUrl = `https://api.bilibili.com/x/web-interface/view?aid=${videoId}`;
                } else {
                    apiUrl = `https://api.bilibili.com/x/web-interface/view?bvid=${videoId}`;
                }

                const response = await fetch(apiUrl, {
                    method: 'GET',
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const data = await response.json();
                if (data.code === 0 && data.data && data.data.title) {
                    return data.data.title;
                }

                throw new Error('API返回错误');
            } catch (error) {
                return null;
            }
        },

        // 处理评论内容中的视频链接和表情符号 - 增强版
        async processCommentContentEnhanced(content, replyEmoteData = null) {
            if (!content) return '内容为空';

            const escapedContent = this.escapeHtml(content);

            // 收集视频匹配并记录占用区间，避免同一片段被重复识别
            const videoMatches = [];
            const occupiedRanges = [];

            const hasOverlap = (start, end) => {
                return occupiedRanges.some(range => start < range.end && end > range.start);
            };

            const normalizeBvid = (bvid) => bvid.replace(/^bv/i, 'BV');

            const addVideoMatch = (fullMatch, type, id, index) => {
                if (!id) return;

                const start = index;
                const end = start + fullMatch.length;
                if (hasOverlap(start, end)) return;

                videoMatches.push({
                    type,
                    id,
                    fullMatch,
                    start,
                    end
                });

                occupiedRanges.push({ start, end });
            };

            // 优先匹配完整视频链接，保证短链如 https://b23.tv/BV... 作为整体处理
            const videoUrlPattern = /https?:\/\/(?:www\.)?(?:b23\.tv\/(?:av\d+|BV[a-zA-Z0-9]+)|bilibili\.com\/video\/(?:av\d+|BV[a-zA-Z0-9]+)(?:\/?[^\s<>"']*)?)/gi;
            let match;
            while ((match = videoUrlPattern.exec(escapedContent)) !== null) {
                const fullUrl = match[0];
                const avMatch = fullUrl.match(/(?:\/video\/|b23\.tv\/)av(\d+)/i);
                const bvMatch = fullUrl.match(/(?:\/video\/|b23\.tv\/)(BV[a-zA-Z0-9]+)/i);

                if (avMatch) {
                    addVideoMatch(fullUrl, 'av', avMatch[1], match.index);
                } else if (bvMatch) {
                    addVideoMatch(fullUrl, 'bv', normalizeBvid(bvMatch[1]), match.index);
                }
            }

            // 再匹配纯 av/BV 号
            const avPattern = /\bav(\d+)\b/gi;
            while ((match = avPattern.exec(escapedContent)) !== null) {
                addVideoMatch(match[0], 'av', match[1], match.index);
            }

            const bvPattern = /\b(BV[a-zA-Z0-9]+)\b/gi;
            while ((match = bvPattern.exec(escapedContent)) !== null) {
                addVideoMatch(match[0], 'bv', normalizeBvid(match[1]), match.index);
            }

            // 没有视频匹配时仅处理表情
            if (videoMatches.length === 0) {
                return this.processEmoticons(escapedContent, replyEmoteData);
            }

            // 使用占位符避免后续 replace 命中已插入的链接 HTML
            const sortedMatches = videoMatches.sort((a, b) => a.start - b.start);
            let contentWithPlaceholders = '';
            let cursor = 0;

            sortedMatches.forEach((video, index) => {
                video.placeholder = `__BILI_VIDEO_LINK_${index}__`;
                contentWithPlaceholders += escapedContent.slice(cursor, video.start) + video.placeholder;
                cursor = video.end;
            });
            contentWithPlaceholders += escapedContent.slice(cursor);

            // 先处理表情符号，再回填视频链接
            let processedContent = this.processEmoticons(contentWithPlaceholders, replyEmoteData);

            const titlePromiseCache = new Map();
            const videoData = await Promise.all(sortedMatches.map(video => {
                const cacheKey = `${video.type}:${video.id}`;
                if (!titlePromiseCache.has(cacheKey)) {
                    titlePromiseCache.set(cacheKey, this.getVideoTitle(video.id, video.type === 'av'));
                }
                return titlePromiseCache.get(cacheKey).then(title => ({ ...video, title }));
            }));

            for (const video of videoData) {
                const url = video.type === 'av'
                    ? `https://www.bilibili.com/video/av${video.id}/`
                    : `https://www.bilibili.com/video/${video.id}/`;

                const title = video.title || video.fullMatch;
                const linkHtml = this.createVideoLinkHtml(url, title);
                processedContent = processedContent.replace(video.placeholder, linkHtml);
            }

            return processedContent;
        },

        // 创建B站风格的视频链接HTML - 暗色主题优化
        createVideoLinkHtml(url, title) {
            // 限制标题长度，避免过长
            const displayTitle = title.length > 30 ? title.substring(0, 30) + '...' : title;

            return `<a href="${url}" target="_blank" class="bili-video-link-enhanced" style="--icon-width:1.2em;--icon-height:1.2em;color:#00a1d6;text-decoration:none;display:inline-flex;align-items:center;gap:6px;transition:all 0.2s ease;border-radius:6px;padding:4px 8px;background:rgba(0,161,214,0.08);border:1px solid rgba(0,161,214,0.2);margin:2px 0;max-width:300px;" data-type="link" title="${title}">
                <img src="https://i0.hdslb.com/bfs/activity-plat/static/20201110/4c8b2dbaded282e67c9a31daa4297c3c/AeQJlYP7e.png" loading="lazy" style="width:var(--icon-width);height:var(--icon-height);vertical-align:middle;flex-shrink:0;filter:brightness(1.1);" alt="播放">
                <span style="color:#00a1d6;font-weight:500;font-size:13px;line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${displayTitle}</span>
            </a>`;
        },

        // 为增强版视频链接添加悬停效果 - 暗色主题优化
        addEnhancedVideoLinkHoverEffects(container) {
            const videoLinks = container.querySelectorAll('.bili-video-link-enhanced');
            videoLinks.forEach(link => {
                link.addEventListener('mouseover', () => {
                    link.style.background = 'rgba(0,161,214,0.15)';
                    link.style.borderColor = 'rgba(0,161,214,0.4)';
                    link.style.transform = 'translateY(-1px)';
                    link.style.boxShadow = '0 2px 8px rgba(0,161,214,0.2)';
                    const span = link.querySelector('span');
                    if (span) span.style.color = '#40a9ff';
                    const img = link.querySelector('img');
                    if (img) img.style.filter = 'brightness(1.3)';
                });

                link.addEventListener('mouseout', () => {
                    link.style.background = 'rgba(0,161,214,0.08)';
                    link.style.borderColor = 'rgba(0,161,214,0.2)';
                    link.style.transform = 'translateY(0)';
                    link.style.boxShadow = 'none';
                    const span = link.querySelector('span');
                    if (span) span.style.color = '#00a1d6';
                    const img = link.querySelector('img');
                    if (img) img.style.filter = 'brightness(1.1)';
                });

                // 点击效果
                link.addEventListener('mousedown', () => {
                    link.style.transform = 'translateY(0) scale(0.98)';
                });

                link.addEventListener('mouseup', () => {
                    link.style.transform = 'translateY(-1px) scale(1)';
                });
            });
        },

        formatNumber(num) {
            if (num >= 10000) {
                return `${(num / 10000).toFixed(1)}万`;
            }
            return num.toString();
        },

        async sleep(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        },

        async fetchWithRetry(url, options = {}, retries = CONFIG.MAX_RETRIES) {
            for (let i = 0; i < retries; i++) {
                try {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT);

                    const response = await fetch(url, {
                        ...options,
                        signal: controller.signal,
                        headers: {
                            'User-Agent': navigator.userAgent,
                            'Referer': window.location.href,
                            ...options.headers
                        }
                    });

                    clearTimeout(timeoutId);

                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                    }

                    return response;
                } catch (error) {
                    if (i === retries - 1) {
                        throw error;
                    }

                    await Utils.sleep(CONFIG.RETRY_DELAY * (i + 1));
                }
            }
        }
    };

    // B站评论API组件
    class BilibiliCommentAPI {
        constructor() {
            this.cache = new Map();
            this.cacheExpiry = 5 * 60 * 1000; // 5分钟缓存
        }

        getCacheKey(type, oid, rpid = null, page = 1, pageSize = '') {
            return `${type}_${oid}_${rpid || 'root'}_${page}_${pageSize}`;
        }

        isValidCache(cacheItem) {
            return cacheItem && (Date.now() - cacheItem.timestamp) < this.cacheExpiry;
        }

        async getCommentReplies(oid, rootRpid, page = 1, pageSize = CONFIG.REPLY_PAGE_SIZE) {
            const cacheKey = this.getCacheKey('replies', oid, rootRpid, page, pageSize);
            const cached = this.cache.get(cacheKey);

            if (this.isValidCache(cached)) {
                Utils.log('info', `使用缓存数据: ${cacheKey}`);
                return { ...cached.data, __fromCache: true };
            }

            try {
                const url = new URL(`${CONFIG.API_BASE}/x/v2/reply/reply`);
                url.searchParams.set('type', CONFIG.COMMENT_TYPE);
                url.searchParams.set('oid', oid);
                url.searchParams.set('root', rootRpid);
                url.searchParams.set('ps', pageSize);
                url.searchParams.set('pn', page);

                Utils.log('info', `请求评论回复: ${url.toString()}`);
                const response = await Utils.fetchWithRetry(url.toString());
                const data = await response.json();

                if (data.code !== 0) {
                    throw new Error(`API错误: ${data.message || '未知错误'} (code: ${data.code})`);
                }

                // 缓存结果
                this.cache.set(cacheKey, {
                    data: data.data,
                    timestamp: Date.now()
                });

                Utils.log('info', `成功获取评论回复: ${data.data?.replies?.length || 0} 条`);
                return { ...data.data, __fromCache: false };

            } catch (error) {
                Utils.log('error', '获取评论回复失败:', error);
                throw error;
            }
        }

        async getAllReplies(oid, rootRpid, maxPages = CONFIG.REPLY_MAX_PAGES, pageSize = CONFIG.REPLY_PAGE_SIZE, concurrency = CONFIG.REPLY_FETCH_CONCURRENCY) {
            const allRepliesCacheKey = this.getCacheKey('replies_all', oid, rootRpid, maxPages, pageSize);
            const allRepliesCached = this.cache.get(allRepliesCacheKey);
            if (this.isValidCache(allRepliesCached)) {
                Utils.log('info', `使用完整回复缓存: ${allRepliesCacheKey}`);
                return allRepliesCached.data;
            }

            const pageResults = new Map();
            const safeConcurrency = Math.max(1, Number(concurrency) || 1);

            const firstPageData = await this.getCommentReplies(oid, rootRpid, 1, pageSize);

            pageResults.set(1, firstPageData?.replies || []);

            const firstPageInfo = firstPageData?.page;
            if (!(firstPageInfo && firstPageInfo.count && firstPageInfo.size)) {
                throw new Error('回复分页信息缺失');
            }

            let totalPages = Math.ceil(firstPageInfo.count / firstPageInfo.size);
            totalPages = Math.max(1, Math.min(totalPages, maxPages));

            if (totalPages > 1) {
                const remainingPages = [];
                for (let p = 2; p <= totalPages; p++) {
                    remainingPages.push(p);
                }

                let cursor = 0;
                const workerCount = Math.min(safeConcurrency, remainingPages.length);

                const worker = async () => {
                    while (true) {
                        const currentIndex = cursor++;
                        if (currentIndex >= remainingPages.length) {
                            break;
                        }

                        const currentPage = remainingPages[currentIndex];
                        const data = await this.getCommentReplies(oid, rootRpid, currentPage, pageSize);
                        pageResults.set(currentPage, data?.replies || []);
                    }
                };

                await Promise.all(Array.from({ length: workerCount }, () => worker()));
            }

            const allReplies = [];
            const fetchedPages = Array.from(pageResults.keys()).sort((a, b) => a - b);
            for (const page of fetchedPages) {
                const pageReplies = pageResults.get(page);
                if (pageReplies && pageReplies.length > 0) {
                    allReplies.push(...pageReplies);
                }
            }

            if (Math.ceil(firstPageInfo.count / firstPageInfo.size) > maxPages) {
                Utils.log('warn', `回复抓取触发页数上限: maxPages=${maxPages}, pageSize=${pageSize}, 已获取=${allReplies.length}`);
            }

            this.cache.set(allRepliesCacheKey, {
                data: allReplies,
                timestamp: Date.now()
            });

            Utils.log('info', `总共获取到 ${allReplies.length} 条回复 (并发=${safeConcurrency})`);
            return allReplies;
        }

        async getCommentInfo(oid, rpid) {
            const cacheKey = this.getCacheKey('info', oid, rpid);
            const cached = this.cache.get(cacheKey);

            if (this.isValidCache(cached)) {
                return cached.data;
            }

            try {
                const url = new URL(`${CONFIG.API_BASE}/x/v2/reply/info`);
                url.searchParams.set('type', CONFIG.COMMENT_TYPE);
                url.searchParams.set('oid', oid);
                url.searchParams.set('rpid', rpid);

                const response = await Utils.fetchWithRetry(url.toString());
                const data = await response.json();

                if (data.code !== 0) {
                    throw new Error(`API错误: ${data.message || '未知错误'} (code: ${data.code})`);
                }

                this.cache.set(cacheKey, {
                    data: data.data,
                    timestamp: Date.now()
                });

                return data.data;

            } catch (error) {
                throw error;
            }
        }

        clearCache() {
            this.cache.clear();
            Utils.log('info', 'API缓存已清空');
        }
    }

    // DOM监听器组件
    class DOMWatcher {
        constructor() {
            this.observer = null;
            this.isObserving = false;
            this.viewMoreButtons = new Set();
            this.onViewMoreClick = null;
            this.intervalId = null;
            this.scanInterval = 1000; // 增加扫描频率到1秒
        }

        observeCommentSection() {
            if (this.isObserving) {
                Utils.log('warn', 'DOM监听器已在运行');
                return;
            }

            this.observer = new MutationObserver((mutations) => {
                let shouldRescan = false;

                mutations.forEach((mutation) => {
                    // 检查是否有节点被添加或移除
                    if (mutation.type === 'childList') {
                        // 检查是否涉及评论相关的DOM变化
                        const hasCommentChanges = Array.from(mutation.addedNodes).some(node =>
                            node.nodeType === Node.ELEMENT_NODE &&
                            (node.tagName === 'BILI-COMMENT-THREAD-RENDERER' ||
                             node.querySelector && node.querySelector('bili-comment-thread-renderer'))
                        ) || Array.from(mutation.removedNodes).some(node =>
                            node.nodeType === Node.ELEMENT_NODE &&
                            (node.tagName === 'BILI-COMMENT-THREAD-RENDERER' ||
                             node.querySelector && node.querySelector('bili-comment-thread-renderer'))
                        );

                        if (hasCommentChanges) {
                            shouldRescan = true;
                        }
                    }
                });

                if (shouldRescan) {
                    // 延迟一点时间让DOM完全更新
                    setTimeout(() => {
                        this.scanForViewMoreButtons();
                        this.reattachMissingButtons();
                    }, 100);
                }
            });

            const targetNode = document.body;
            const config = {
                childList: true,
                subtree: true,
                attributes: false
            };

            this.observer.observe(targetNode, config);
            this.isObserving = true;

            this.startPeriodicScan();
            this.scanForViewMoreButtons();
            Utils.log('info', 'DOM监听器已启动 - 增强版');
        }

        startPeriodicScan() {
            if (this.intervalId) {
                clearInterval(this.intervalId);
            }

            this.intervalId = setInterval(() => {
                this.scanForViewMoreButtons();
                this.reattachMissingButtons();
            }, this.scanInterval);

            Utils.log('info', `定时检测已启动，每 ${this.scanInterval}ms 检测一次`);
        }

        // 重新附加丢失的瀑布流按钮
        reattachMissingButtons() {
            try {
                const commentApp = document.querySelector("#commentapp > bili-comments");
                if (!commentApp || !commentApp.shadowRoot) return;

                const threadRenderers = commentApp.shadowRoot.querySelectorAll("#feed > bili-comment-thread-renderer");
                let reattachedCount = 0;

                threadRenderers.forEach((threadRenderer) => {
                    if (!threadRenderer.shadowRoot) return;

                    const repliesRenderer = threadRenderer.shadowRoot.querySelector("#replies > bili-comment-replies-renderer");
                    if (!repliesRenderer || !repliesRenderer.shadowRoot) return;

                    const viewMoreButton = repliesRenderer.shadowRoot.querySelector("#view-more > bili-text-button");
                    if (!viewMoreButton || !viewMoreButton.shadowRoot) return;

                    // 检查是否已有评论展开按钮
                    const existingExpandBtn = this.findExpandButton(threadRenderer);
                    if (!existingExpandBtn) {
                        // 如果没有评论展开按钮，重新添加
                        const button = viewMoreButton.shadowRoot.querySelector("button");
                        if (button && this.viewMoreButtons.has(button)) {
                            // 这个按钮之前已经处理过，但评论展开按钮丢失了
                            const commentInfo = this.extractCommentInfo(viewMoreButton, threadRenderer);
                            if (commentInfo) {
                                this.addExpandButtonToStableLocation(threadRenderer, commentInfo);
                                reattachedCount++;
                            }
                        }
                    }
                });

                if (reattachedCount > 0) {
                    Utils.log('info', `重新附加了 ${reattachedCount} 个评论展开按钮`);
                }

            } catch (error) {
                Utils.log('error', '重新附加按钮时出错:', error);
            }
        }

        // 查找评论展开按钮（优化版）
        findExpandButton(threadRenderer) {
            try {
                // 优先在主要位置查找（基于实际使用情况优化）
                const primaryLocations = [
                    threadRenderer.shadowRoot?.querySelector("#replies"),
                    threadRenderer
                ];

                for (const location of primaryLocations) {
                    if (location) {
                        // 直接查找按钮
                        const expandBtn = location.querySelector?.('.bili-comment-expand-btn');
                        if (expandBtn) {
                            return expandBtn;
                        }
                        // 检查shadowRoot
                        if (location.shadowRoot) {
                            const expandBtn = location.shadowRoot.querySelector('.bili-comment-expand-btn');
                            if (expandBtn) {
                                return expandBtn;
                            }
                        }
                    }
                }
                return null;
            } catch (error) {
                return null;
            }
        }

        scanForViewMoreButtons() {
            try {
                const commentApp = document.querySelector("#commentapp > bili-comments");
                if (!commentApp || !commentApp.shadowRoot) {
                    Utils.log('warn', '未找到评论区或shadowRoot');
                    return;
                }

                const threadRenderers = commentApp.shadowRoot.querySelectorAll("#feed > bili-comment-thread-renderer");
                Utils.log('info', `扫描评论区: 找到 ${threadRenderers.length} 个评论线程`);
                let newButtonsFound = 0;

                threadRenderers.forEach((threadRenderer) => {
                    if (!threadRenderer.shadowRoot) return;

                    const repliesRenderer = threadRenderer.shadowRoot.querySelector("#replies > bili-comment-replies-renderer");
                    if (!repliesRenderer || !repliesRenderer.shadowRoot) return;

                    const viewMoreButton = repliesRenderer.shadowRoot.querySelector("#view-more > bili-text-button");
                    if (!viewMoreButton || !viewMoreButton.shadowRoot) return;

                    const button = viewMoreButton.shadowRoot.querySelector("button");
                    if (!button) return;

                    if (!this.viewMoreButtons.has(button)) {
                        this.processViewMoreButton(viewMoreButton, button, threadRenderer);
                        newButtonsFound++;
                    }
                });

                // 只在有新按钮时输出日志
                if (newButtonsFound > 0) {
                    Utils.log('info', `新处理了 ${newButtonsFound} 个"点击查看"按钮，总计: ${this.viewMoreButtons.size}`);
                }

            } catch (error) {
                Utils.log('error', '扫描按钮时出错:', error);
            }
        }

        processViewMoreButton(container, button, threadRenderer) {
            this.viewMoreButtons.add(button);
            button.setAttribute('data-waterfall-processed', 'true');

            const commentInfo = this.extractCommentInfo(container, threadRenderer);
            if (!commentInfo) {
                return;
            }

            this.addExpandButtonToStableLocation(commentInfo.commentElement, commentInfo);
            Utils.log('info', `已添加评论展开按钮，评论ID: ${commentInfo.rootId}, 回复数: ${commentInfo.replyCount}`);
        }

        // 将评论展开按钮添加到固定位置
        addExpandButtonToStableLocation(threadRenderer, commentInfo) {
            if (this.findExpandButton(threadRenderer)) {
                Utils.log('info', '评论展开按钮已存在，跳过添加');
                return;
            }

            const targetContainer = threadRenderer.shadowRoot?.querySelector("#replies");
            if (!targetContainer) {
                throw new Error('未找到目标容器 #replies');
            }

            const expandBtn = this.createExpandButton(commentInfo);
            const buttonWrapper = document.createElement('div');
            buttonWrapper.className = 'bili-comment-expand-wrapper';
            buttonWrapper.style.cssText = `
                display: flex;
                justify-content: center;
                align-items: center;
                margin: 8px 0;
                position: relative;
                z-index: 1000;
                width: 100%;
            `;
            buttonWrapper.appendChild(expandBtn);
            targetContainer.appendChild(buttonWrapper);
            Utils.log('info', '评论展开按钮已添加到 #replies');
        }

        // 创建评论展开按钮（提取为独立方法）
        createExpandButton(commentInfo) {
            const expandBtn = document.createElement('button');
            expandBtn.className = 'bili-comment-expand-btn';
            expandBtn.style.cssText = `
                padding: 8px 16px;
                background: linear-gradient(135deg, #00a1d6, #0084b4);
                color: #ffffff;
                border: 1px solid rgba(0, 161, 214, 0.3);
                border-radius: 6px;
                font-size: 12px;
                font-weight: 500;
                cursor: pointer;
                transition: all 0.3s ease;
                box-shadow: 0 2px 6px rgba(0, 161, 214, 0.2);
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
                position: relative;
                overflow: hidden;
                min-width: 120px;
            `;

            // 添加展开图标和文字 - 使用展开箭头符号
            expandBtn.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="filter: drop-shadow(0 1px 2px rgba(0,0,0,0.3));">
                    <path d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z"/>
                </svg>
                <span style="text-shadow: 0 1px 2px rgba(0,0,0,0.3);">展开回复</span>
            `;

            // 悬停效果 - 更丰富的动画
            expandBtn.onmouseover = () => {
                expandBtn.style.background = 'linear-gradient(135deg, #40a9ff, #1890ff)';
                expandBtn.style.transform = 'translateY(-2px) scale(1.05)';
                expandBtn.style.boxShadow = '0 6px 12px rgba(0, 161, 214, 0.4)';
                expandBtn.style.borderColor = 'rgba(64, 169, 255, 0.6)';
            };

            expandBtn.onmouseout = () => {
                expandBtn.style.background = 'linear-gradient(135deg, #00a1d6, #0084b4)';
                expandBtn.style.transform = 'translateY(0) scale(1)';
                expandBtn.style.boxShadow = '0 2px 6px rgba(0, 161, 214, 0.2)';
                expandBtn.style.borderColor = 'rgba(0, 161, 214, 0.3)';
            };

            // 点击效果
            expandBtn.onmousedown = () => {
                expandBtn.style.transform = 'translateY(0) scale(0.95)';
            };

            expandBtn.onmouseup = () => {
                expandBtn.style.transform = 'translateY(-2px) scale(1.05)';
            };

            // 绑定点击事件
            expandBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.handleExpandClick(commentInfo);
            };

            return expandBtn;
        }

        handleExpandClick(commentInfo) {
            // 调用主控制器的处理函数
            if (this.onViewMoreClick) {
                this.onViewMoreClick(commentInfo);
            }
        }

        extractCommentInfo(container, threadRenderer) {
            try {
                // 从容器文本中提取回复数量
                const containerText = container.textContent || '';
                const replyCountMatch = containerText.match(/(\d+)\s*条回复/) || containerText.match(/共\s*(\d+)\s*条/) || containerText.match(/(\d+)\s*回复/);
                const replyCount = replyCountMatch ? parseInt(replyCountMatch[1], 10) : 0;

                // 更强力的评论ID提取
                const rootId = this.extractCommentId(threadRenderer);
                const oid = this.extractVideoId();

                Utils.log('info', `提取到的信息: rootId=${rootId}, oid=${oid}, replyCount=${replyCount}`);

                if (!rootId) {
                    Utils.log('warn', '无法提取评论ID');
                    return null;
                }

                if (!oid) {
                    Utils.log('warn', '无法提取视频ID');
                    return null;
                }

                return {
                    rootId,
                    oid,
                    replyCount,
                    container,
                    commentElement: threadRenderer
                };
            } catch (error) {
                Utils.log('error', '提取评论信息失败', error);
                return null;
            }
        }

        extractCommentId(threadRenderer) {
            const rpid = threadRenderer?.__data?.rpid;
            if (!rpid) return null;
            return rpid.toString();
        }

        extractVideoId() {
            const aid = window.__INITIAL_STATE__?.aid;
            if (!aid) return null;
            return aid.toString();
        }



        setViewMoreClickHandler(handler) {
            this.onViewMoreClick = handler;
        }

        getProcessedButtonCount() {
            return this.viewMoreButtons.size;
        }

        destroy() {
            if (this.observer) {
                this.observer.disconnect();
                this.observer = null;
            }

            if (this.intervalId) {
                clearInterval(this.intervalId);
                this.intervalId = null;
            }

            this.isObserving = false;
            this.viewMoreButtons.clear();
            this.onViewMoreClick = null;
        }
    }

    // 主控制器
    class BilibiliCommentExpandController {
        constructor() {
            this.domWatcher = new DOMWatcher();
            this.commentAPI = new BilibiliCommentAPI();
            this.isInitialized = false;
        }

        async initialize() {
            if (this.isInitialized) {
                Utils.log('warn', '脚本已初始化');
                return;
            }

            try {
                Utils.log('info', '开始初始化Bilibili评论展开助手脚本');
                this.setupEventHandlers();
                this.domWatcher.observeCommentSection();

                this.isInitialized = true;
                Utils.log('info', 'Bilibili评论展开助手脚本初始化完成');

            } catch (error) {
                Utils.log('error', '脚本初始化失败', error);
                throw error;
            }
        }

        setupEventHandlers() {
            this.domWatcher.setViewMoreClickHandler((commentInfo) => {
                this.handleViewMoreClick(commentInfo);
            });
            Utils.log('info', '事件处理函数已设置');
        }

        async handleViewMoreClick(commentInfo) {
            try {
                Utils.log('info', '处理评论展开按钮点击', commentInfo);

                // 显示加载提示
                this.showLoadingIndicator();

                if (!commentInfo.rootId || !commentInfo.oid) {
                    throw new Error('评论信息不完整');
                }

                Utils.log('info', `开始获取回复数据: oid=${commentInfo.oid}, rootId=${commentInfo.rootId}`);
                const realReplies = await this.commentAPI.getAllReplies(commentInfo.oid, commentInfo.rootId);
                const replyCount = realReplies.length;
                Utils.log('info', `成功获取 ${realReplies.length} 条真实回复数据`);

                // 创建评论展开弹出框，传入真实数据
                Utils.log('info', `创建弹出框: replyCount=${replyCount}, realReplies.length=${realReplies.length}`);
                this.createExpandModal(replyCount, realReplies);

                // 隐藏加载提示
                this.hideLoadingIndicator();

            } catch (error) {
                Utils.log('error', '处理"点击查看"按钮失败', error);
                this.hideLoadingIndicator();
            }
        }

        showLoadingIndicator() {
            const loading = document.createElement('div');
            loading.id = 'bili-comment-expand-loading';
            loading.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: rgba(0, 0, 0, 0.8);
                color: #fff;
                padding: 12px 20px;
                border-radius: 4px;
                z-index: 10001;
                font-size: 14px;
            `;
            loading.textContent = '正在加载评论...';
            document.body.appendChild(loading);
        }

        hideLoadingIndicator() {
            const loading = document.getElementById('bili-comment-expand-loading');
            if (loading) {
                loading.remove();
            }
        }

        createExpandModal(replyCount, realReplies = []) {
            const docStyle = document.documentElement.style;
            const bodyStyle = document.body.style;
            const previousDocStyle = {
                overflow: docStyle.overflow,
                overscrollBehavior: docStyle.overscrollBehavior,
                scrollBehavior: docStyle.scrollBehavior
            };
            const previousBodyStyle = {
                overflow: bodyStyle.overflow,
                overscrollBehavior: bodyStyle.overscrollBehavior,
                scrollBehavior: bodyStyle.scrollBehavior,
                paddingRight: bodyStyle.paddingRight
            };
            const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

            // 打开弹窗时锁定页面滚动，避免背景滚动
            docStyle.overflow = 'hidden';
            docStyle.overscrollBehavior = 'none';
            docStyle.scrollBehavior = 'auto';
            bodyStyle.overflow = 'hidden';
            bodyStyle.overscrollBehavior = 'none';
            bodyStyle.scrollBehavior = 'auto';
            if (scrollbarWidth > 0) {
                bodyStyle.paddingRight = `${scrollbarWidth}px`;
            }

            // 创建遮罩层
            const overlay = document.createElement('div');
            overlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.8);
                z-index: 10000;
                display: flex;
                align-items: center;
                justify-content: center;
                backdrop-filter: blur(4px);
                overscroll-behavior: contain;
            `;

            // 创建弹出框 - 暗色主题，模仿Bilibili原生设计
            const modal = document.createElement('div');
            modal.style.cssText = `
                background: #1f1f1f;
                border: 1px solid #3a3a3a;
                border-radius: 8px;
                width: 85%;
                max-width: 900px;
                max-height: 85%;
                display: flex;
                flex-direction: column;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
                color: #e1e2e3;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            `;

            // 创建头部 - 暗色主题
            const header = document.createElement('div');
            header.style.cssText = `
                padding: 16px 20px;
                border-bottom: 1px solid #3a3a3a;
                display: flex;
                justify-content: space-between;
                align-items: center;
                background: #2a2a2a;
                border-radius: 8px 8px 0 0;
            `;

            const title = document.createElement('h3');
            title.style.cssText = `
                margin: 0;
                font-size: 16px;
                font-weight: 500;
                color: #e1e2e3;
            `;
            title.textContent = `评论回复 (${replyCount}条)`;

            const closeButton = document.createElement('button');
            closeButton.style.cssText = `
                background: none;
                border: none;
                font-size: 20px;
                cursor: pointer;
                color: #9499a0;
                padding: 4px;
                width: 28px;
                height: 28px;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 4px;
                transition: all 0.2s ease;
            `;
            closeButton.textContent = '×';

            // 关闭按钮悬停效果
            closeButton.onmouseover = () => {
                closeButton.style.background = '#3a3a3a';
                closeButton.style.color = '#ffffff';
            };
            closeButton.onmouseout = () => {
                closeButton.style.background = 'none';
                closeButton.style.color = '#9499a0';
            };

            header.appendChild(title);
            header.appendChild(closeButton);

            // 创建内容区域 - 暗色主题，左对齐
            const body = document.createElement('div');
            body.style.cssText = `
                flex: 1;
                overflow: auto;
                background: #1f1f1f;
                color: #9499a0;
                text-align: left;
            `;

            const repliesViewController = this.renderRepliesContent(body, realReplies, replyCount, modal, overlay);

            modal.appendChild(header);
            modal.appendChild(body);
            overlay.appendChild(modal);

            const restoreBackgroundScroll = () => {
                docStyle.overflow = previousDocStyle.overflow;
                docStyle.overscrollBehavior = previousDocStyle.overscrollBehavior;
                bodyStyle.overflow = previousBodyStyle.overflow;
                bodyStyle.overscrollBehavior = previousBodyStyle.overscrollBehavior;
                bodyStyle.paddingRight = previousBodyStyle.paddingRight;

                // 在恢复位置后再还原滚动行为，避免出现平滑回滚动画
                requestAnimationFrame(() => {
                    docStyle.scrollBehavior = previousDocStyle.scrollBehavior;
                    bodyStyle.scrollBehavior = previousBodyStyle.scrollBehavior;
                });
            };

            const closeModal = () => {
                document.removeEventListener('keydown', escHandler);
                if (repliesViewController && typeof repliesViewController.destroy === 'function') {
                    repliesViewController.destroy();
                }
                restoreBackgroundScroll();
                if (overlay.parentNode) {
                    overlay.remove();
                }
            };

            closeButton.onclick = closeModal;

            // 点击遮罩层关闭
            overlay.onclick = (e) => {
                if (e.target === overlay) {
                    closeModal();
                }
            };

            // ESC键关闭
            const escHandler = (e) => {
                if (e.key === 'Escape') {
                    closeModal();
                }
            };
            document.addEventListener('keydown', escHandler);

            // 避免滚动事件穿透到背景页面
            const preventBackgroundScroll = (e) => {
                if (e.target === overlay) {
                    e.preventDefault();
                }
            };
            overlay.addEventListener('wheel', preventBackgroundScroll, { passive: false });
            overlay.addEventListener('touchmove', preventBackgroundScroll, { passive: false });

            document.body.appendChild(overlay);
        }

        renderRepliesContent(container, replies, totalCount, modalElement = null, overlayElement = null) {
            const replyFloorMap = this.buildReplyFloorMap(replies);
            const replyIndex = this.buildReplyIndex(replies);

            container.style.display = 'flex';
            container.style.flexDirection = 'column';
            container.style.minHeight = '0';
            container.style.overflow = 'hidden';

            // 创建排序控制 - 暗色主题
            const sortControls = document.createElement('div');
            sortControls.style.cssText = `
                padding: 12px 20px;
                border-bottom: 1px solid #3a3a3a;
                display: flex;
                justify-content: space-between;
                align-items: center;
                background: #2a2a2a;
            `;

            const sortInfo = document.createElement('span');
            sortInfo.style.cssText = 'font-size: 13px; color: #9499a0;';
            sortInfo.textContent = `共 ${totalCount} 条回复，显示 ${replies.length} 条`;

            const sortButtons = document.createElement('div');
            sortButtons.style.cssText = 'display: flex; gap: 8px;';

            const hotSortBtn = this.createSortButton('按热度', true);
            const timeSortBtn = this.createSortButton('按时间↓', false);

            sortButtons.appendChild(hotSortBtn);
            sortButtons.appendChild(timeSortBtn);

            sortControls.appendChild(sortInfo);
            sortControls.appendChild(sortButtons);

            // 回复列表容器 - 暗色主题
            const repliesContainer = document.createElement('div');
            repliesContainer.style.cssText = `
                flex: 1;
                min-width: 0;
                overflow-y: auto;
                padding: 0;
                background: #1f1f1f;
            `;

            // 对话链侧边浮层（不占用原列表布局）
            const conversationPanel = document.createElement('div');
            conversationPanel.style.cssText = `
                position: fixed;
                width: 340px;
                max-width: min(92vw, 360px);
                min-width: 280px;
                border: 1px solid #3a3a3a;
                background: #181818;
                display: none;
                flex-direction: column;
                border-radius: 8px;
                overflow: hidden;
                box-shadow: 0 10px 28px rgba(0, 0, 0, 0.5);
                z-index: 10002;
            `;

            const conversationHeader = document.createElement('div');
            conversationHeader.style.cssText = `
                padding: 12px 14px;
                border-bottom: 1px solid #3a3a3a;
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
            `;

            const conversationTitle = document.createElement('span');
            conversationTitle.style.cssText = `
                color: #e1e2e3;
                font-size: 13px;
                font-weight: 600;
            `;
            conversationTitle.textContent = '回复对话';

            const conversationCloseBtn = document.createElement('button');
            conversationCloseBtn.type = 'button';
            conversationCloseBtn.style.cssText = `
                border: 1px solid #4a4a4a;
                background: #2a2a2a;
                color: #9499a0;
                border-radius: 4px;
                font-size: 12px;
                padding: 2px 8px;
                cursor: pointer;
                transition: all 0.2s ease;
            `;
            conversationCloseBtn.textContent = '关闭';
            conversationCloseBtn.onmouseover = () => {
                conversationCloseBtn.style.borderColor = '#00a1d6';
                conversationCloseBtn.style.color = '#00a1d6';
            };
            conversationCloseBtn.onmouseout = () => {
                conversationCloseBtn.style.borderColor = '#4a4a4a';
                conversationCloseBtn.style.color = '#9499a0';
            };

            const conversationBody = document.createElement('div');
            conversationBody.style.cssText = `
                flex: 1;
                min-height: 0;
                overflow-y: auto;
                padding: 12px;
                background: #181818;
            `;

            conversationHeader.appendChild(conversationTitle);
            conversationHeader.appendChild(conversationCloseBtn);
            conversationPanel.appendChild(conversationHeader);
            conversationPanel.appendChild(conversationBody);

            const panelHost = overlayElement || document.body;
            panelHost.appendChild(conversationPanel);

            // 初始化排序状态
            let currentSort = 'hot';
            let timeOrder = 'desc'; // 'desc' 为倒序（最新在前），'asc' 为正序（最旧在前）
            let activeConversationReplyId = '';
            const panelGap = 12;
            const panelMargin = 12;

            const positionConversationPanel = () => {
                if (!modalElement) {
                    conversationPanel.style.right = `${panelMargin}px`;
                    conversationPanel.style.top = `${panelMargin}px`;
                    conversationPanel.style.height = `${Math.max(260, Math.floor(window.innerHeight * 0.7))}px`;
                    return;
                }

                const modalRect = modalElement.getBoundingClientRect();
                const panelWidth = Math.min(360, Math.max(280, conversationPanel.offsetWidth || 340));
                let left = modalRect.right + panelGap;

                if (left + panelWidth + panelMargin > window.innerWidth) {
                    left = modalRect.left - panelGap - panelWidth;
                }
                if (left < panelMargin) {
                    left = Math.max(panelMargin, window.innerWidth - panelWidth - panelMargin);
                }

                const top = Math.max(panelMargin, Math.min(modalRect.top, window.innerHeight - 220));
                const maxHeight = Math.max(160, window.innerHeight - top - panelMargin);
                const preferredHeight = Math.max(260, Math.min(modalRect.height, Math.floor(window.innerHeight * 0.8)));
                const height = Math.min(preferredHeight, maxHeight);

                conversationPanel.style.left = `${Math.round(left)}px`;
                conversationPanel.style.top = `${Math.round(top)}px`;
                conversationPanel.style.height = `${Math.round(height)}px`;
                conversationPanel.style.right = '';
            };

            const onViewportChange = () => {
                if (conversationPanel.style.display !== 'none') {
                    positionConversationPanel();
                }
            };
            window.addEventListener('resize', onViewportChange);

            const renderReplies = () => {
                this.renderRepliesList(
                    repliesContainer,
                    replies,
                    currentSort,
                    timeOrder,
                    replyFloorMap,
                    handleViewConversation,
                    activeConversationReplyId
                );
            };

            const hideConversationPanel = () => {
                activeConversationReplyId = '';
                conversationPanel.style.display = 'none';
                conversationTitle.textContent = '回复对话';
                conversationBody.innerHTML = '';
                renderReplies();
            };

            const handleViewConversation = (reply) => {
                const selectedReplyId = this.getReplyId(reply);
                if (!selectedReplyId) {
                    return;
                }

                const chain = this.buildReplyChain(reply, replyIndex);
                if (chain.length === 0) {
                    return;
                }

                activeConversationReplyId = selectedReplyId;
                conversationTitle.textContent = `回复对话 (${chain.length}层)`;
                this.renderReplyChainPanel(conversationBody, chain, selectedReplyId);
                conversationPanel.style.display = 'flex';
                positionConversationPanel();
                requestAnimationFrame(positionConversationPanel);
                renderReplies();
            };

            conversationCloseBtn.onclick = hideConversationPanel;

            // 渲染回复列表
            renderReplies();

            // 绑定排序事件
            hotSortBtn.onclick = () => {
                currentSort = 'hot';
                this.updateSortButtons(hotSortBtn, timeSortBtn);
                renderReplies();
            };

            timeSortBtn.onclick = () => {
                if (currentSort === 'time') {
                    // 如果已经是时间排序，则切换正序/倒序
                    timeOrder = timeOrder === 'desc' ? 'asc' : 'desc';
                } else {
                    // 如果不是时间排序，则切换到时间排序（默认倒序）
                    currentSort = 'time';
                    timeOrder = 'desc';
                }

                // 更新按钮文本
                timeSortBtn.textContent = `按时间${timeOrder === 'desc' ? '↓' : '↑'}`;

                this.updateSortButtons(timeSortBtn, hotSortBtn);
                renderReplies();
            };

            container.appendChild(sortControls);
            container.appendChild(repliesContainer);

            return {
                destroy: () => {
                    window.removeEventListener('resize', onViewportChange);
                    if (conversationPanel.parentNode) {
                        conversationPanel.remove();
                    }
                }
            };
        }

        createSortButton(text, active) {
            const button = document.createElement('button');
            button.style.cssText = `
                padding: 6px 14px;
                border: 1px solid ${active ? '#00a1d6' : '#4a4a4a'};
                background: ${active ? '#00a1d6' : '#3a3a3a'};
                color: ${active ? '#ffffff' : '#e1e2e3'};
                border-radius: 6px;
                cursor: pointer;
                font-size: 12px;
                font-weight: 500;
                transition: all 0.2s ease;
            `;
            button.textContent = text;

            button.onmouseover = () => {
                if (!button.classList.contains('active')) {
                    button.style.borderColor = '#00a1d6';
                    button.style.background = '#4a4a4a';
                    button.style.color = '#00a1d6';
                }
            };

            button.onmouseout = () => {
                if (!button.classList.contains('active')) {
                    button.style.borderColor = '#4a4a4a';
                    button.style.background = '#3a3a3a';
                    button.style.color = '#e1e2e3';
                }
            };

            if (active) {
                button.classList.add('active');
            }

            return button;
        }

        updateSortButtons(activeBtn, inactiveBtn) {
            // 更新活跃按钮 - 暗色主题
            activeBtn.style.background = '#00a1d6';
            activeBtn.style.color = '#ffffff';
            activeBtn.style.borderColor = '#00a1d6';
            activeBtn.classList.add('active');

            // 更新非活跃按钮 - 暗色主题
            inactiveBtn.style.background = '#3a3a3a';
            inactiveBtn.style.color = '#e1e2e3';
            inactiveBtn.style.borderColor = '#4a4a4a';
            inactiveBtn.classList.remove('active');
        }

        buildReplyFloorMap(replies) {
            const floorMap = new Map();

            // 优先使用接口直接返回的楼层字段
            replies.forEach(reply => {
                const apiFloor = Number(reply?.floor ?? reply?.reply_control?.floor);
                if (Number.isFinite(apiFloor) && apiFloor > 0) {
                    floorMap.set(reply, { value: Math.floor(apiFloor), source: 'api' });
                }
            });

            return floorMap;
        }

        getReplyId(reply) {
            const rpid = reply?.rpid;
            return rpid === undefined || rpid === null ? '' : String(rpid);
        }

        getParentReplyId(reply) {
            const parent = reply?.parent;
            return parent === undefined || parent === null ? '' : String(parent);
        }

        getRootReplyId(reply) {
            const root = reply?.root;
            return root === undefined || root === null ? '' : String(root);
        }

        isReplyToAnotherComment(reply) {
            const replyId = this.getReplyId(reply);
            const parentId = this.getParentReplyId(reply);
            const rootId = this.getRootReplyId(reply);
            return Boolean(parentId && parentId !== rootId && parentId !== replyId);
        }

        buildReplyIndex(replies) {
            const replyIndex = new Map();
            replies.forEach(reply => {
                const replyId = this.getReplyId(reply);
                if (replyId) {
                    replyIndex.set(replyId, reply);
                }
            });
            return replyIndex;
        }

        buildReplyChain(selectedReply, replyIndex) {
            const chain = [];
            if (!selectedReply) {
                return chain;
            }

            const visited = new Set();
            let cursor = selectedReply;

            while (cursor) {
                const cursorId = this.getReplyId(cursor);
                if (!cursorId || visited.has(cursorId)) {
                    break;
                }

                visited.add(cursorId);
                chain.unshift(cursor);

                const parentId = this.getParentReplyId(cursor);
                const rootId = this.getRootReplyId(cursor);
                if (!parentId || parentId === rootId || parentId === cursorId) {
                    break;
                }

                cursor = replyIndex.get(parentId) || null;
            }

            return chain;
        }

        renderReplyChainPanel(container, chain, activeReplyId) {
            container.innerHTML = '';

            chain.forEach((reply, index) => {
                if (index > 0) {
                    const arrow = document.createElement('div');
                    arrow.style.cssText = `
                        color: #6b6f76;
                        text-align: center;
                        margin: 4px 0;
                        font-size: 12px;
                    `;
                    arrow.textContent = '↓';
                    container.appendChild(arrow);
                }

                const replyId = this.getReplyId(reply);
                const isCurrent = replyId === activeReplyId;
                const card = document.createElement('div');
                card.style.cssText = `
                    border: 1px solid ${isCurrent ? 'rgba(0, 161, 214, 0.45)' : '#353535'};
                    background: ${isCurrent ? 'rgba(0, 161, 214, 0.08)' : '#202020'};
                    border-radius: 8px;
                    padding: 10px 12px;
                `;

                const header = document.createElement('div');
                header.style.cssText = `
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    margin-bottom: 8px;
                    font-size: 12px;
                    color: #9499a0;
                `;

                const username = document.createElement('span');
                username.style.cssText = `
                    color: #e1e2e3;
                    font-weight: 600;
                    max-width: 120px;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                `;
                username.textContent = reply.member?.uname || '匿名用户';

                const time = document.createElement('span');
                time.textContent = Utils.formatTime(reply.ctime);

                header.appendChild(username);
                header.appendChild(time);

                if (isCurrent) {
                    const tag = document.createElement('span');
                    tag.style.cssText = `
                        margin-left: auto;
                        color: #40a9ff;
                        border: 1px solid rgba(64, 169, 255, 0.5);
                        border-radius: 999px;
                        padding: 1px 6px;
                        font-size: 11px;
                    `;
                    tag.textContent = '当前回复';
                    header.appendChild(tag);
                }

                const message = document.createElement('div');
                message.style.cssText = `
                    color: #d0d2d6;
                    font-size: 13px;
                    line-height: 1.5;
                    word-break: break-word;
                `;
                const originalContent = reply.content?.message || '';
                const replyEmoteData = reply.content?.emote || null;
                message.innerHTML = Utils.processEmoticons(Utils.escapeHtml(originalContent), replyEmoteData);

                card.appendChild(header);
                card.appendChild(message);
                container.appendChild(card);
            });
        }

        renderRepliesList(
            container,
            replies,
            sortType,
            timeOrder = 'desc',
            replyFloorMap = new Map(),
            onViewConversation = null,
            activeConversationReplyId = ''
        ) {
            // 排序回复
            const sortedReplies = [...replies].sort((a, b) => {
                if (sortType === 'hot') {
                    return (b.like || 0) - (a.like || 0);
                } else if (sortType === 'time') {
                    const timeA = a.ctime || 0;
                    const timeB = b.ctime || 0;
                    return timeOrder === 'desc' ? timeB - timeA : timeA - timeB;
                }
                return 0;
            });

            // 清空容器
            container.innerHTML = '';

            // 渲染每条回复
            sortedReplies.forEach((reply) => {
                const floorInfo = replyFloorMap.get(reply) || null;
                const replyElement = this.createReplyElement(
                    reply,
                    floorInfo,
                    onViewConversation,
                    activeConversationReplyId
                );
                container.appendChild(replyElement);
            });
        }

        createReplyElement(reply, floorInfo = null, onViewConversation = null, activeConversationReplyId = '') {
            const replyDiv = document.createElement('div');
            replyDiv.style.cssText = `
                padding: 16px 20px;
                border-bottom: 1px solid #3a3a3a;
                display: flex;
                gap: 12px;
                transition: background-color 0.2s ease;
                background: #1f1f1f;
            `;

            const replyId = this.getReplyId(reply);
            const isConversationActive = activeConversationReplyId && replyId === activeConversationReplyId;
            if (activeConversationReplyId && replyId === activeConversationReplyId) {
                replyDiv.style.boxShadow = 'inset 3px 0 0 #00a1d6';
                replyDiv.style.background = '#252525';
            }

            replyDiv.onmouseover = () => {
                replyDiv.style.backgroundColor = '#2a2a2a';
            };

            replyDiv.onmouseout = () => {
                replyDiv.style.backgroundColor = isConversationActive ? '#252525' : '#1f1f1f';
            };

            // 用户头像 - 模仿Bilibili原生尺寸
            const avatar = document.createElement('img');
            avatar.style.cssText = `
                width: 40px;
                height: 40px;
                border-radius: 50%;
                flex-shrink: 0;
                object-fit: cover;
                border: 2px solid #3a3a3a;
            `;
            avatar.src = reply.member?.avatar || 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMjAiIGZpbGw9IiM0YTRhNGEiLz4KPHRleHQgeD0iMjAiIHk9IjI2IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LXNpemU9IjE0IiBmaWxsPSIjOTQ5OWEwIj7nlKg8L3RleHQ+Cjwvc3ZnPgo=';
            avatar.alt = reply.member?.uname || '用户';

            // 内容区域
            const content = document.createElement('div');
            content.style.cssText = 'flex: 1; min-width: 0;';

            // 用户信息行 - 模仿Bilibili原生布局
            const userInfo = document.createElement('div');
            userInfo.style.cssText = `
                display: flex;
                align-items: center;
                gap: 8px;
                margin-bottom: 10px;
                font-size: 13px;
            `;

            const username = document.createElement('span');
            const vipColor = reply.member?.vip?.nickname_color;
            const userId = reply.member?.mid || reply.mid;

            username.style.cssText = `
                font-weight: 500;
                color: ${vipColor || '#e1e2e3'};
                max-width: 150px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                cursor: pointer;
                transition: all 0.2s ease;
                border-bottom: 1px solid transparent;
            `;
            username.textContent = reply.member?.uname || '匿名用户';

            // 添加用户名点击跳转功能
            if (userId) {
                username.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const userUrl = `https://space.bilibili.com/${userId}`;
                    window.open(userUrl, '_blank');
                };

                // 悬停效果
                username.onmouseover = () => {
                    username.style.borderBottomColor = vipColor || '#e1e2e3';
                    username.style.color = vipColor || '#ffffff';
                };

                username.onmouseout = () => {
                    username.style.borderBottomColor = 'transparent';
                    username.style.color = vipColor || '#e1e2e3';
                };
            }

            // 时间显示 - 添加tooltip显示详细时间
            const timeSpan = document.createElement('span');
            timeSpan.style.cssText = `
                color: #9499a0;
                font-size: 12px;
                cursor: help;
            `;
            timeSpan.textContent = Utils.formatTime(reply.ctime);
            timeSpan.title = Utils.formatDetailedTime(reply.ctime);

            userInfo.appendChild(username);
            userInfo.appendChild(timeSpan);

            if (floorInfo && floorInfo.value) {
                const floorTag = document.createElement('span');
                floorTag.style.cssText = `
                    margin-left: auto;
                    padding: 2px 8px;
                    border-radius: 999px;
                    background: rgba(0, 161, 214, 0.12);
                    border: 1px solid rgba(0, 161, 214, 0.35);
                    color: #40a9ff;
                    font-size: 12px;
                    line-height: 1.4;
                    white-space: nowrap;
                `;
                floorTag.textContent = `${floorInfo.value}楼`;
                floorTag.title = '接口返回楼层';
                userInfo.appendChild(floorTag);
            }

            // 评论内容 - 暗色主题，支持视频链接识别
            const messageDiv = document.createElement('div');
            messageDiv.style.cssText = `
                color: #e1e2e3;
                line-height: 1.6;
                margin-bottom: 12px;
                word-break: break-word;
                font-size: 14px;
                text-align: left;
            `;

            // 处理评论内容中的视频链接 - 使用增强版
            // 先同步渲染文本+表情，避免被视频标题请求阻塞
            const originalContent = reply.content?.message || '';
            const replyEmoteData = reply.content?.emote || null;
            const escapedContent = Utils.escapeHtml(originalContent);
            messageDiv.innerHTML = Utils.processEmoticons(escapedContent, replyEmoteData);

            const hasVideoReference = /(?:https?:\/\/(?:www\.)?(?:b23\.tv\/|bilibili\.com\/video\/)|\bav\d+\b|\bBV[a-zA-Z0-9]+\b)/i.test(originalContent);
            if (hasVideoReference) {
                // 异步处理视频链接（完成后覆盖为完整内容）
                Utils.processCommentContentEnhanced(originalContent, replyEmoteData).then(processedContent => {
                    messageDiv.innerHTML = processedContent;
                    // 为增强版视频链接添加悬停效果
                    Utils.addEnhancedVideoLinkHoverEffects(messageDiv);
                }).catch((error) => {
                    Utils.log('error', '处理评论内容失败', error);
                    messageDiv.innerHTML = Utils.processEmoticons(Utils.escapeHtml(originalContent), replyEmoteData);
                });
            }

            // 互动信息 - 模仿Bilibili原生样式
            const actions = document.createElement('div');
            actions.style.cssText = `
                display: flex;
                align-items: center;
                gap: 20px;
                font-size: 12px;
                color: #9499a0;
            `;

            const likeSpan = document.createElement('span');
            likeSpan.style.cssText = `
                display: flex;
                align-items: center;
                gap: 4px;
                cursor: pointer;
                padding: 4px 8px;
                border-radius: 4px;
                transition: all 0.2s ease;
            `;
            likeSpan.innerHTML = `👍 ${Utils.formatNumber(reply.like || 0)}`;

            // 点赞按钮悬停效果
            likeSpan.onmouseover = () => {
                likeSpan.style.background = '#3a3a3a';
                likeSpan.style.color = '#00a1d6';
            };
            likeSpan.onmouseout = () => {
                likeSpan.style.background = 'transparent';
                likeSpan.style.color = '#9499a0';
            };

            actions.appendChild(likeSpan);

            if (this.isReplyToAnotherComment(reply) && typeof onViewConversation === 'function') {
                const conversationBtn = document.createElement('button');
                conversationBtn.type = 'button';
                conversationBtn.textContent = '查看对话';
                conversationBtn.style.cssText = `
                    border: 1px solid ${isConversationActive ? '#00a1d6' : '#4a4a4a'};
                    background: ${isConversationActive ? 'rgba(0, 161, 214, 0.12)' : '#2a2a2a'};
                    color: ${isConversationActive ? '#40a9ff' : '#c9ccd1'};
                    border-radius: 4px;
                    font-size: 12px;
                    padding: 4px 8px;
                    cursor: pointer;
                    transition: all 0.2s ease;
                `;

                conversationBtn.onmouseover = () => {
                    if (!isConversationActive) {
                        conversationBtn.style.borderColor = '#00a1d6';
                        conversationBtn.style.color = '#00a1d6';
                    }
                };

                conversationBtn.onmouseout = () => {
                    if (!isConversationActive) {
                        conversationBtn.style.borderColor = '#4a4a4a';
                        conversationBtn.style.color = '#c9ccd1';
                    }
                };

                conversationBtn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onViewConversation(reply);
                };

                actions.appendChild(conversationBtn);
            }

            content.appendChild(userInfo);
            content.appendChild(messageDiv);
            content.appendChild(actions);

            replyDiv.appendChild(avatar);
            replyDiv.appendChild(content);

            return replyDiv;
        }

        destroy() {
            try {
                this.domWatcher.destroy();
                this.commentAPI.clearCache();
                this.isInitialized = false;
                Utils.log('info', 'Bilibili评论展开助手脚本已销毁');
            } catch (error) {
                Utils.log('error', '脚本销毁失败', error);
            }
        }

        getStatus() {
            return {
                initialized: this.isInitialized,
                processedButtons: this.domWatcher.getProcessedButtonCount()
            };
        }
    }

    // 全局实例
    let commentExpandController = null;

    // 脚本入口点
    function initializeScript() {
        try {
            Utils.log('info', '=== Bilibili评论展开助手脚本启动 ===');
            Utils.log('info', `当前页面: ${window.location.href}`);

            if (!window.location.href.includes('bilibili.com/video/')) {
                Utils.log('warn', '当前页面不是bilibili视频页面，脚本将不会运行');
                return;
            }

            commentExpandController = new BilibiliCommentExpandController();

            commentExpandController.initialize().then(() => {
                Utils.log('info', '脚本初始化成功');

                window.bilibiliCommentExpand = {
                    controller: commentExpandController,
                    getStatus: () => commentExpandController.getStatus(),
                    destroy: () => commentExpandController.destroy()
                };

                Utils.log('info', '全局调试接口已添加: window.bilibiliCommentExpand');

            }).catch((error) => {
                Utils.log('error', '脚本初始化失败', error);
            });

        } catch (error) {
            Utils.log('error', '脚本启动失败', error);
        }
    }

    // 页面卸载时清理资源
    window.addEventListener('beforeunload', () => {
        if (commentExpandController) {
            commentExpandController.destroy();
        }
    });

    // 启动脚本
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeScript);
    } else {
        setTimeout(initializeScript, 1000);
    }

    Utils.log('info', 'Bilibili评论展开助手脚本 v2.5.0 已加载 - 优化按钮附加和用户体验');

})();
