export const exampleBlocks = (zh: boolean) => zh ? {
  goal: '建设客户服务门户，把分散在邮件中的工单集中管理，缩短指派时间并明确关闭责任。',
  functions: '创建和查询客户工单\n按工单类型指派运营处理人\n由部门负责人审批工单关闭',
  people: '客户服务部\n运营部', responsibility: '客户服务负责人\n客服专员\n运营处理人\n部门审批人',
  workflow: '客服创建工单，运营接单并记录处理结果，部门负责人审批关闭；驳回后退回处理人。',
  data: '使用普通客户联系记录和工单正文；对接现有客户目录，不保存支付信息。',
  constraints: '内部部署，允许业务中断 8 小时；首期 8 周完成。', acceptance: '本期只做工单闭环，不做计费。验证可创建、指派、关闭及越权访问被拒绝。',
} : {
  goal: 'Build a customer service portal to centralize email-based tickets, reduce assignment time, and establish closure accountability.',
  functions: 'Create and search customer tickets\nAssign operations owners by ticket category\nApprove ticket closure through a department lead',
  people: 'Customer service\nOperations', responsibility: 'Customer service owner\nService agent\nOperations handler\nDepartment approver',
  workflow: 'Service creates a ticket; operations records the resolution; the department lead approves closure. Rejection returns it to the handler.',
  data: 'Ordinary customer contact records and ticket descriptions; integrate an existing customer directory. No payment data.',
  constraints: 'Internal deployment. Eight hours of interruption is tolerable. Deliver the first phase in eight weeks.',
  acceptance: 'In scope: the ticket lifecycle. Out of scope: billing. Test creation, assignment, closure, and denied unauthorized access.',
}
