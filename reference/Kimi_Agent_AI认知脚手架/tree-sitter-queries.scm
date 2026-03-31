; =============================================================================
; Tree-sitter查询语句集合
; 用于代码复用检测和克隆检测
; =============================================================================

; =============================================================================
; TypeScript/JavaScript 查询
; =============================================================================

; 函数声明匹配
(function_declaration
    name: (identifier)? @func.name
    parameters: (formal_parameters) @func.params
    return_type: (type_annotation)? @func.return
    body: (statement_block) @func.body) @func.def

; 箭头函数匹配
(arrow_function
    parameters: (formal_parameters)? @func.params
    body: (_) @func.body) @func.def

; 方法定义匹配
(method_definition
    name: (property_identifier)? @func.name
    parameters: (formal_parameters) @func.params
    return_type: (type_annotation)? @func.return
    body: (statement_block) @func.body) @func.def

; 类声明匹配
(class_declaration
    name: (type_identifier) @class.name
    body: (class_body) @class.body) @class.def

; 导出函数匹配
(export_statement
    (function_declaration
        name: (identifier) @export.name) @export.def) @export.stmt

; 导出类匹配
(export_statement
    (class_declaration
        name: (type_identifier) @export.name) @export.def) @export.stmt

; 导出接口匹配
(export_statement
    (interface_declaration
        name: (type_identifier) @export.name) @export.def) @export.stmt

; 导出类型别名匹配
(export_statement
    (type_alias_declaration
        name: (type_identifier) @export.name) @export.def) @export.stmt

; 命名导出匹配
(export_specifier
    name: (identifier) @export.spec.name) @export.spec

; 导入声明匹配
(import_statement
    (import_clause
        (identifier)? @import.default
        (named_imports
            (import_specifier
                name: (identifier) @import.name))) @import.clause
    source: (string) @import.source) @import.stmt

; 从特定模块导入
(import_statement
    (import_clause (identifier) @import.default)
    source: (string) @import.source) @import.stmt

; 变量声明匹配
(variable_declaration
    (variable_declarator
        name: (identifier) @var.name
        type: (type_annotation)? @var.type
        value: (_)? @var.value)) @var.def

; 常量声明匹配
(lexical_declaration
    "const"
    (variable_declarator
        name: (identifier) @const.name
        value: (_)? @const.value)) @const.def

; For循环匹配
(for_statement
    initializer: (_) @loop.init
    condition: (_) @loop.cond
    increment: (_) @loop.inc
    body: (statement_block) @loop.body) @loop.def

; For-of循环匹配
(for_in_statement
    left: (_) @loop.left
    right: (_) @loop.right
    body: (statement_block) @loop.body) @loop.def

; While循环匹配
(while_statement
    condition: (_) @loop.cond
    body: (statement_block) @loop.body) @loop.def

; Try-catch匹配
(try_statement
    body: (statement_block) @try.body
    handler: (catch_clause
        parameter: (identifier)? @catch.param
        body: (statement_block) @catch.body) @catch.clause
    finalizer: (finally_clause
        body: (statement_block) @finally.body)? @finally.clause) @try.def

; =============================================================================
; Python 查询
; =============================================================================

; 函数定义匹配
(function_definition
    name: (identifier) @func.name
    parameters: (parameters) @func.params
    return_type: (type)? @func.return
    body: (block) @func.body) @func.def

; 异步函数定义匹配
(async_function_definition
    name: (identifier) @func.name
    parameters: (parameters) @func.params
    return_type: (type)? @func.return
    body: (block) @func.body) @func.def

; Lambda表达式匹配
(lambda
    parameters: (lambda_parameters)? @lambda.params
    body: (_) @lambda.body) @lambda.def

; 类定义匹配
(class_definition
    name: (identifier) @class.name
    superclasses: (argument_list)? @class.bases
    body: (block) @class.body) @class.def

; 类方法匹配
(class_definition
    body: (block
        (function_definition
            name: (identifier) @method.name
            parameters: (parameters) @method.params
            body: (block) @method.body) @method.def))

; 装饰器匹配
(decorated_definition
    (decorator
        (identifier) @decorator.name
        (argument_list)? @decorator.args) @decorator.def
    definition: (_) @decorated.def) @decorated.stmt

; 导入语句匹配
(import_statement
    name: (dotted_name
        (identifier) @import.name) @import.dotted) @import.stmt

; From导入匹配
(import_from_statement
    module: (dotted_name)? @import.module
    name: (dotted_name (identifier) @import.name)) @import.from

; For循环匹配
(for_statement
    left: (_) @loop.target
    right: (_) @loop.iter
    body: (block) @loop.body
    alternative: (else_clause
        body: (block) @loop.else)? @loop.else_clause) @loop.def

; While循环匹配
(while_statement
    condition: (_) @loop.cond
    body: (block) @loop.body
    alternative: (else_clause
        body: (block) @loop.else)? @loop.else_clause) @loop.def

; Try-except匹配
(try_statement
    body: (block) @try.body
    handlers: (except_clause
        type: (_)? @except.type
        alias: (identifier)? @except.alias
        body: (block) @except.body)* @except.clauses
    alternative: (else_clause
        body: (block) @try.else)? @try.else_clause
    finalizer: (finally_clause
        body: (block) @try.finally)? @try.finally_clause) @try.def

; With语句匹配
(with_statement
    (with_clause
        (with_item
            value: (_) @with.value
            alias: (identifier)? @with.alias)) @with.clause
    body: (block) @with.body) @with.def

; 赋值语句匹配
(expression_statement
    (assignment
        left: (_) @assign.left
        right: (_) @assign.right) @assign.def) @assign.stmt

; =============================================================================
; Go 查询
; =============================================================================

; 函数声明匹配
(function_declaration
    name: (identifier) @func.name
    parameters: (parameter_list) @func.params
    result: (_)? @func.return
    body: (block) @func.body) @func.def

; 方法声明匹配（带接收器）
(method_declaration
    receiver: (parameter_list) @method.receiver
    name: (field_identifier) @method.name
    parameters: (parameter_list) @method.params
    result: (_)? @method.return
    body: (block) @method.body) @method.def

; 接口类型匹配
(interface_type
    (method_spec
        name: (field_identifier) @interface.method.name
        parameters: (parameter_list) @interface.method.params
        result: (_)? @interface.method.return) @interface.method.def)

; 结构体类型匹配
(struct_type
    (field_declaration_list
        (field_declaration
            name: (field_identifier) @struct.field.name
            type: (_) @struct.field.type) @struct.field.def)) @struct.def

; 类型声明匹配
(type_declaration
    (type_spec
        name: (type_identifier) @type.name
        type: (_) @type.value) @type.def) @type.decl

; 常量声明匹配
(const_declaration
    (const_spec
        name: (identifier) @const.name
        type: (_)? @const.type
        value: (_)? @const.value) @const.def) @const.decl

; 变量声明匹配
(var_declaration
    (var_spec
        name: (identifier) @var.name
        type: (_)? @var.type
        value: (_)? @var.value) @var.def) @var.decl

; 导入声明匹配
(import_declaration
    (import_spec
        path: (interpreted_string_literal) @import.path
        name: (identifier)? @import.name) @import.spec) @import.decl

; For循环匹配
(for_statement
    condition: (_)? @loop.cond
    body: (block) @loop.body) @loop.def

; For-range循环匹配
(for_statement
    clause: (range_clause
        left: (_) @range.left
        right: (_) @range.right) @range.clause
    body: (block) @loop.body) @range.def

; If语句匹配
(if_statement
    condition: (_) @if.cond
    consequence: (block) @if.then
    alternative: (block)? @if.else) @if.def

; Switch语句匹配
(switch_statement
    value: (_)? @switch.value
    body: (switch_body
        (case_clause
            value: (_)* @case.values
            body: (statement_list) @case.body) @case.clause) @switch.body) @switch.def

; Defer语句匹配
(defer_statement
    expression: (_) @defer.expr) @defer.def

; Go语句匹配
(go_statement
    expression: (_) @go.expr) @go.def

; =============================================================================
; 高级克隆检测查询
; =============================================================================

; 检测相似的错误处理模式
; TypeScript/JavaScript
(catch_clause
    body: (statement_block
        (expression_statement
            (call_expression
                function: (member_expression
                    object: (identifier) @logger
                    property: (property_identifier) @log.method)
                arguments: (arguments
                    (string) @log.message))) @log.stmt)) @error.handler

; Python
(except_clause
    body: (block
        (expression_statement
            (call
                function: (attribute
                    object: (identifier) @logger
                    attribute: (identifier) @log.method)
                arguments: (argument_list
                    (string) @log.message))) @log.stmt)) @error.handler

; 检测相似的验证模式
; TypeScript/JavaScript
(if_statement
    condition: (binary_expression
        left: (_) @check.left
        operator: "===" @check.op
        right: (_) @check.right) @check.cond
    consequence: (statement_block
        (throw_statement
            argument: (new_expression
                constructor: (identifier) @error.type
                arguments: (arguments
                    (string) @error.message))) @throw.stmt)) @validation.def

; Python
(if_statement
    condition: (comparison_operator
        (_) @check.left
        "==" @check.op
        (_) @check.right) @check.cond
    consequence: (block
        (raise_statement
            exception: (call
                function: (identifier) @error.type
                arguments: (argument_list
                    (string) @error.message))) @raise.stmt)) @validation.def
