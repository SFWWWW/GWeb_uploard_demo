/**
 * 应用配置
 * ---------------------------------------------------------------
 * mode: 'local'    零配置，数据存在当前浏览器（适合单机演示）
 * mode: 'supabase' 云端同步，手机扫码上传后后台可跨设备查看
 *
 * 切换到 supabase 时：
 * 1. 在 Supabase 控制台执行同目录下的 supabase.sql
 * 2. 填入 Project URL 与 anon public key（anon key 可公开，勿填 service_role key）
 * 3. siteBaseUrl 填 GitHub Pages 站点根路径，例如：
 *    https://<用户名>.github.io/<仓库名>/demo/
 *    留空则自动按当前页面路径推断
 */
(function (global) {
  'use strict';

  var defaults = {
    mode: 'local',
    supabaseUrl: '',
    supabaseAnonKey: '',
    storageBucket: 'booklet-photos',
    siteBaseUrl: '',
    maxEdge: 1600,
    jpegQuality: 0.78
  };

  global.APP_CONFIG = Object.assign({}, defaults, global.APP_CONFIG || {});
})(window);
