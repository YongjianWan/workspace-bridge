"""
AI认知脚手架系统 - 使用示例
============================
演示如何使用核心算法进行代码分析
"""

from core_algorithms import (
    CognitiveScaffoldingSystem,
    SymbolIndex,
    DependencyGraph,
    DependencyEdge,
    DependencyType,
    PageRankCalculator,
    ImpactPropagationAnalyzer,
    RiskClassifier,
    DeadCodeDetector,
    ASTSimilarityAnalyzer,
    Symbol,
    SymbolType,
    Language,
    Location
)


def example_1_basic_usage():
    """示例1: 基本使用流程"""
    print("=" * 60)
    print("示例1: 基本使用流程")
    print("=" * 60)
    
    # 初始化系统
    system = CognitiveScaffoldingSystem("/path/to/your/project")
    
    # 注意: 实际使用时需要调用initialize()进行初始化
    # system.initialize()
    
    print("✓ 系统初始化完成")
    print("  - 扫描项目文件")
    print("  - 构建符号索引")
    print("  - 构建依赖图")
    print("  - 计算PageRank")


def example_2_symbol_indexing():
    """示例2: 符号索引操作"""
    print("\n" + "=" * 60)
    print("示例2: 符号索引操作")
    print("=" * 60)
    
    index = SymbolIndex()
    
    # 添加符号
    symbol1 = Symbol(
        name="calculate_sum",
        qualified_name="utils.calculate_sum",
        symbol_type=SymbolType.FUNCTION,
        language=Language.PYTHON,
        location=Location("utils.py", 10, 20)
    )
    
    symbol2 = Symbol(
        name="UserService",
        qualified_name="services.UserService",
        symbol_type=SymbolType.CLASS,
        language=Language.TYPESCRIPT,
        location=Location("services/user.ts", 1, 50)
    )
    
    index.add_symbol(symbol1)
    index.add_symbol(symbol2)
    
    # 查询符号
    print("\n按名称查询 'calculate_sum':")
    results = index.query_by_name("calculate_sum")
    for sym in results:
        print(f"  - {sym.qualified_name} at {sym.location.file_path}:{sym.location.line_start}")
    
    print("\n按文件查询 'utils.py':")
    results = index.query_by_file("utils.py")
    for sym in results:
        print(f"  - {sym.qualified_name}")
    
    print("\n按类型查询 FUNCTION:")
    results = index.query_by_type(SymbolType.FUNCTION)
    for sym in results:
        print(f"  - {sym.qualified_name}")


def example_3_dependency_graph():
    """示例3: 依赖图操作"""
    print("\n" + "=" * 60)
    print("示例3: 依赖图操作")
    print("=" * 60)
    
    graph = DependencyGraph()
    
    # 添加依赖边
    edges = [
        ("main.py", "utils.py", DependencyType.IMPORT),
        ("utils.py", "helpers.py", DependencyType.IMPORT),
        ("api.py", "utils.py", DependencyType.CALLS),
        ("api.py", "models.py", DependencyType.IMPORT),
    ]
    
    for src, tgt, dep_type in edges:
        graph.add_edge(DependencyEdge(
            source=src,
            target=tgt,
            dep_type=dep_type
        ))
    
    print("\n依赖图统计:")
    print(f"  - 节点数: {len(graph.nodes)}")
    print(f"  - 边数: {len(graph.edges)}")
    
    print("\nutils.py 的依赖:")
    deps = graph.get_dependencies("utils.py")
    for dep in deps:
        print(f"  -> {dep}")
    
    print("\nutils.py 的被依赖:")
    dependents = graph.get_dependents("utils.py")
    for dep in dependents:
        print(f"  <- {dep}")


def example_4_pagerank():
    """示例4: PageRank中心性计算"""
    print("\n" + "=" * 60)
    print("示例4: PageRank中心性计算")
    print("=" * 60)
    
    graph = DependencyGraph()
    
    # 构建一个复杂的依赖图
    # A 被 B, C, D 依赖 (核心节点)
    # B 被 E, F 依赖
    # C 被 G 依赖
    # D, E, F, G 是叶子节点
    
    edges = [
        ("B", "A", DependencyType.IMPORT),
        ("C", "A", DependencyType.IMPORT),
        ("D", "A", DependencyType.IMPORT),
        ("E", "B", DependencyType.CALLS),
        ("F", "B", DependencyType.CALLS),
        ("G", "C", DependencyType.CALLS),
    ]
    
    for src, tgt, dep_type in edges:
        graph.add_edge(DependencyEdge(source=src, target=tgt, dep_type=dep_type))
    
    # 计算PageRank
    calculator = PageRankCalculator(damping_factor=0.85, max_iterations=100)
    scores = calculator.calculate(graph)
    
    print("\nPageRank分数 (按重要性排序):")
    sorted_scores = sorted(scores.items(), key=lambda x: x[1], reverse=True)
    for node, score in sorted_scores:
        dependents = len(graph.get_dependents(node))
        print(f"  {node}: {score:.4f} (被{dependents}个文件依赖)")
    
    # 识别核心节点
    core_nodes = calculator.identify_core_nodes(scores, graph, min_dependents=2)
    print("\n核心节点 (>2个依赖):")
    for node, score, dep_count in core_nodes:
        print(f"  🔴 {node}: score={score:.4f}, dependents={dep_count}")


def example_5_impact_analysis():
    """示例5: 影响传播分析"""
    print("\n" + "=" * 60)
    print("示例5: 影响传播分析")
    print("=" * 60)
    
    graph = DependencyGraph()
    
    # 构建依赖链: A -> B -> C -> D
    #                    -> E -> F
    edges = [
        ("B", "A", DependencyType.IMPORT),
        ("C", "B", DependencyType.CALLS),
        ("D", "C", DependencyType.CALLS),
        ("E", "B", DependencyType.IMPORT),
        ("F", "E", DependencyType.CALLS),
    ]
    
    for src, tgt, dep_type in edges:
        graph.add_edge(DependencyEdge(source=src, target=tgt, dep_type=dep_type))
    
    # 初始化PageRank分数
    pagerank = {node: 1.0 / len(graph.nodes) for node in graph.nodes}
    
    # 分析修改影响
    analyzer = ImpactPropagationAnalyzer(graph, pagerank, decay_factor=0.5)
    results = analyzer.analyze_impact(["A"], max_depth=3)
    
    print("\n修改 A 的影响分析:")
    for source, result in results.items():
        summary = result.get_risk_summary()
        print(f"\n  源节点: {source}")
        print(f"  - 直接影响: {summary['direct']} 个文件")
        print(f"  - 间接影响: {summary['indirect']} 个文件")
        print(f"  - 传递影响: {summary['transitive']} 个文件")
        print(f"  - 总计影响: {summary['total']} 个文件")
        
        if result.direct_impacts:
            print(f"  直接影响文件: {list(result.direct_impacts)}")
        if result.indirect_impacts:
            print(f"  间接影响文件: {list(result.indirect_impacts)}")
    
    # 生成完整报告
    report = analyzer.generate_impact_report(results)
    print(f"\n影响报告摘要:")
    print(f"  - 修改节点数: {report['summary']['total_modified']}")
    print(f"  - 总影响文件数: {report['summary']['total_affected']}")


def example_6_risk_classification():
    """示例6: 风险分级"""
    print("\n" + "=" * 60)
    print("示例6: 风险分级")
    print("=" * 60)
    
    graph = DependencyGraph()
    
    # 构建测试图
    # core_utils: 被12个文件依赖 (核心节点)
    # api_client: 被5个文件依赖 (普通节点)
    # helper: 被1个文件依赖 (叶子节点)
    
    for i in range(12):
        graph.add_edge(DependencyEdge(
            source=f"module_{i}.py",
            target="core_utils.py",
            dep_type=DependencyType.IMPORT
        ))
    
    for i in range(5):
        graph.add_edge(DependencyEdge(
            source=f"service_{i}.py",
            target="api_client.py",
            dep_type=DependencyType.CALLS
        ))
    
    graph.add_edge(DependencyEdge(
        source="main.py",
        target="helper.py",
        dep_type=DependencyType.IMPORT
    ))
    
    pagerank = {node: 0.1 for node in graph.nodes}
    
    classifier = RiskClassifier(core_threshold=10, medium_threshold=3)
    
    print("\n风险分级结果:")
    for node in ["core_utils.py", "api_client.py", "helper.py"]:
        level, details = classifier.classify(node, graph, pagerank)
        print(f"\n  {node}:")
        print(f"    风险等级: {level}")
        print(f"    被依赖数: {details['dependent_count']}")
        print(f"    PageRank: {details['pagerank_score']:.4f}")


def example_7_dead_code_detection():
    """示例7: 死代码检测"""
    print("\n" + "=" * 60)
    print("示例7: 死代码检测")
    print("=" * 60)
    
    print("\n死代码检测流程:")
    print("  1. 扫描项目文件")
    print("  2. 按语言分类 (Python/TypeScript/Go)")
    print("  3. 调用对应检测工具:")
    print("     - Python: vulture")
    print("     - TypeScript: ts-prune")
    print("     - Go: unused")
    print("  4. 解析检测结果")
    print("  5. 与符号索引集成")
    print("  6. 生成移除建议")
    
    print("\n示例输出:")
    print("  utils.py:42 - unused function 'old_helper' (confidence: 90%)")
    print("  api.ts:15 - unused export 'legacyInterface' (confidence: 85%)")
    print("  models.go:30 - unused type 'OldStruct' (confidence: 95%)")


def example_8_similarity_detection():
    """示例8: 相似度检测"""
    print("\n" + "=" * 60)
    print("示例8: AST相似度检测")
    print("=" * 60)
    
    print("\n相似度检测流程:")
    print("  1. 提取函数AST特征向量")
    print("     - 节点类型分布")
    print("     - 节点深度统计")
    print("     - 子树结构哈希")
    print("     - 标记序列")
    print("  2. 计算相似度 (余弦 + Jaccard + 序列)")
    print("  3. 与阈值 0.85 比较")
    print("  4. 生成复用建议")
    
    print("\n示例场景:")
    print("  新函数: src/components/Button.tsx:handleClick()")
    print("  相似函数: src/components/Link.tsx:handleClick()")
    print("  相似度: 0.92 (> 0.85)")
    print("  建议: 'Consider reusing Link.handleClick instead'")


def example_9_full_workflow():
    """示例9: 完整工作流程"""
    print("\n" + "=" * 60)
    print("示例9: 完整工作流程")
    print("=" * 60)
    
    print("""
场景: 开发者修改了 utils.ts 文件中的 formatDate 函数

系统响应流程:

1. 【符号索引更新】
   - 重新解析 utils.ts
   - 更新 formatDate 符号信息
   
2. 【影响分析】
   - 查找所有依赖 formatDate 的文件
   - 计算二级传递效应
   - 输出: "将影响 5 个文件，其中 2 个为核心模块"
   
3. 【风险分级】
   - formatDate: 🟡 普通节点 (5个依赖)
   - 依赖文件分析:
     * dashboard.tsx: 🔴 核心节点 (15个依赖)
     * reports.ts: 🟡 普通节点 (7个依赖)
     
4. 【复用检查】
   - 检测是否有相似函数
   - 输出: "发现相似函数 dateHelper.ts:formatDate (相似度: 0.88)"
   
5. 【死代码检查】
   - 检查 utils.ts 中是否有未使用代码
   - 输出: "发现 2 个未使用函数"

最终报告:
┌─────────────────────────────────────────┐
│ 修改影响报告                             │
├─────────────────────────────────────────┤
│ 修改文件: utils.ts                       │
│ 修改函数: formatDate                     │
│ 风险等级: 🟡 普通节点                     │
│                                         │
│ 直接影响: 5 个文件                       │
│ 间接影响: 12 个文件                      │
│ 高风险文件: dashboard.tsx, reports.ts    │
│                                         │
│ 复用建议: 考虑合并 dateHelper.ts 中的    │
│           相似函数                       │
│                                         │
│ 死代码: 发现 2 个未使用函数              │
└─────────────────────────────────────────┘
""")


if __name__ == "__main__":
    # 运行所有示例
    example_1_basic_usage()
    example_2_symbol_indexing()
    example_3_dependency_graph()
    example_4_pagerank()
    example_5_impact_analysis()
    example_6_risk_classification()
    example_7_dead_code_detection()
    example_8_similarity_detection()
    example_9_full_workflow()
    
    print("\n" + "=" * 60)
    print("所有示例执行完成!")
    print("=" * 60)
