 ──────                                                                                                                                                
 ### 方法 1：直接在终端运行已打包的  .app  应用程序（最推荐 🌟）                                                                                             
                                                                                                                                                             
 因为打包生成的真实 Release 版 App 就在项目目录下，你可以直接在终端里启动它。这样 App 后端的所有 Rust 输出、报错信息和插件日志都会实时打印在你的终端窗口中： 
                                                                                                                                                             
   # 终端中直接启动打包好的真实 Release App                                                                                                                  
   ./src-tauri/target/release/bundle/macos/Codex\ Usage\ Desktop.app/Contents/MacOS/Codex\ Usage\ Desktop                                                    
                                                                                                                                                             
 （你可以把上面的命令直接复制到终端中运行，如果 App 运行过程中有任何报错，终端里会立刻刷新显示出来。）                                                       
 ──────                                                                                                                                                
 ### 方法 2：实时监听 macOS 本地持久化日志文件（最推荐 🌟）                                                                                                  
                                                                                                                                                             
 Tauri 的日志插件会自动将运行日志持久化到 macOS 系统的标准日志路径下。我刚才在你的系统里确认过，这个日志文件一直在被正常写入：                               
 路径为： ~/Library/Logs/com.ccusage.codex.desktop/Codex Usage Desktop.log                                                                                   
                                                                                                                                                             
 你可以在终端中运行以下命令，实时、滚动地查看真实 App 产生的所有日志（哪怕你是在双击运行打包后的 DMG App）：                                                 
                                                                                                                                                             
   # 实时滚动监听真实 App 的后台日志输出                                                                                                                     
   tail -f ~/Library/Logs/com.ccusage.codex.desktop/Codex\ Usage\ Desktop.log                                                                                
                                                                                                                                                             
 或者直接在 Finder 中打开该日志文件夹，双击用文本编辑器查看：                                                                                                
                                                                                                                                                             
   open ~/Library/Logs/com.ccusage.codex.desktop/                                                                                                            
 ──────                                                                                                                                                
 ### 方法 3：使用 Tauri 的开发命令行模式启动                                                                                                                 
                                                                                                                                                             
 如果你在开发调试，直接运行下面这行命令。它会启动真实的 Tauri 桌面外壳，并把前端控制台（Console）和 Rust 后端的日志混合实时输出到当前终端：                  
                                                                                                                                                             
   pnpm tauri dev                                                                                                                                            
