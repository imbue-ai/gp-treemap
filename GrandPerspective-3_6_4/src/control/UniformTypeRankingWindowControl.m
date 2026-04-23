/* GrandPerspective, Version 3.6.4 
 *   A utility for macOS that graphically shows disk usage. 
 * Copyright (C) 2005-2025, Erwin Bonsma 
 * 
 * This program is free software; you can redistribute it and/or modify it 
 * under the terms of the GNU General Public License as published by the Free 
 * Software Foundation; either version 2 of the License, or (at your option) 
 * any later version. 
 * 
 * This program is distributed in the hope that it will be useful, but WITHOUT 
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or 
 * FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License for 
 * more details. 
 * 
 * You should have received a copy of the GNU General Public License along 
 * with this program; if not, write to the Free Software Foundation, Inc., 
 * 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA. 
 */

#import "UniformTypeRankingWindowControl.h"

#import "UniformTypeRanking.h"
#import "UniformType.h"


NSString  *InternalTableDragType = @"net.sourceforge.grandperspectiv.GrandPerspective.TableRow";


@interface InternalPasteboardWriter : NSObject<NSPasteboardWriting> {
  NSInteger  row;
}

- (instancetype) initWithSourceRow:(NSInteger)row;

@end

@interface TypeCell : NSObject {
  UniformType  *type;
  BOOL  dominated;
}

// Overrides designated initialiser.
- (instancetype) init NS_UNAVAILABLE;

- (instancetype) initWithUniformType:(UniformType *)type
                           dominated:(BOOL)dominated NS_DESIGNATED_INITIALIZER;

@property (nonatomic, readonly, strong) UniformType *uniformType;
@property (nonatomic, getter=isDominated) BOOL dominated;
@property (nonatomic, readonly) NSString *toolTip;

@end // @interface TypeCell


@interface UniformTypeRankingWindowControl (PrivateMethods)

- (void) fetchCurrentTypeList;
- (void) commitChangedTypeList;

- (void) closeWindow;

- (void) updateWindowState;

- (void) moveCellUpFromIndex:(NSUInteger)index;
- (void) moveCellDownFromIndex:(NSUInteger)index;
- (void) movedCellToIndex:(NSUInteger)index;

- (NSUInteger) getRowNumberFromDraggingInfo:(id <NSDraggingInfo>)info;

@end // @interface UniformTypeRankingWindowControl (PrivateMethods)


@implementation UniformTypeRankingWindowControl

- (instancetype) init {
  return [self initWithUniformTypeRanking: UniformTypeRanking.defaultUniformTypeRanking];
}

- (instancetype) initWithUniformTypeRanking: (UniformTypeRanking *)typeRankingVal {
  if (self = [super initWithWindow: nil]) {
    typeRanking = [typeRankingVal retain];
    typeCells = [[NSMutableArray arrayWithCapacity: typeRanking.rankedUniformTypes.count] retain];

    updateTypeList = YES;
  }
  
  return self;
}

- (void) dealloc {
  [typeRanking release];
  [typeCells release];

  [super dealloc];
}


- (NSString *)windowNibName {
  return @"UniformTypeRankingWindow";
}

- (void) windowDidLoad {
  typesTable.delegate = self;
  typesTable.dataSource = self;
  
  [typesTable registerForDraggedTypes: @[InternalTableDragType]];
}


- (IBAction) cancelAction:(id)sender {
  [self closeWindow];
}

- (IBAction) okAction:(id)sender {
  [self commitChangedTypeList];

  [self closeWindow];
}

- (IBAction) moveToTopAction:(id)sender {
  NSInteger  i = typesTable.selectedRow;
  
  while (i > 0) {
    [self moveCellUpFromIndex: i];
    i--;
  }
  
  [self movedCellToIndex: i];
}

- (IBAction) moveToBottomAction:(id)sender {
  NSInteger  i = typesTable.selectedRow;
  NSAssert(i >= 0, @"No row selected");
  
  NSUInteger  max_i = typeCells.count - 1;
  while (i < max_i) {
    [self moveCellDownFromIndex: i];
    i++;
  }

  [self movedCellToIndex: i];
}

- (IBAction) moveToRevealAction:(id)sender {
  NSInteger  i = typesTable.selectedRow;
  NSAssert(i >= 0, @"No row selected");

  while (i > 0 && [typeCells[i] isDominated]) {
    [self moveCellUpFromIndex: i];
    i--;
  }
  
  [self movedCellToIndex: i];
}

- (IBAction) moveToHideAction:(id)sender {
  NSInteger  i = typesTable.selectedRow;
  NSAssert(i >= 0, @"No row selected");

  NSUInteger  max_i = typeCells.count - 1;
  while (i < max_i && ![typeCells[i] isDominated]) {
    [self moveCellDownFromIndex: i];
    i++;
  }
  
  [self movedCellToIndex: i];
}

- (IBAction) moveUpAction:(id)sender {
  NSInteger  i = typesTable.selectedRow;
  NSAssert(i >= 0, @"No row selected");
  
  if (i > 0) {
    [self moveCellUpFromIndex: i];
    i--;
  }
  
  [self movedCellToIndex: i];
}

- (IBAction) moveDownAction:(id)sender {
  NSInteger  i = typesTable.selectedRow;
  NSAssert(i >= 0, @"No row selected");

  NSUInteger  max_i = typeCells.count - 1;
  if (i < max_i) {
    [self moveCellDownFromIndex: i];
    i++;
  }
  
  [self movedCellToIndex: i];
}


//----------------------------------------------------------------------------
// Delegate methods for NSWindow

- (void) windowDidBecomeKey: (NSNotification *)notification { 
  if (updateTypeList) {
    // The window has just been opened. Fetch the latest type list. This resets any uncommitted
    // changes made the last time the window was shown.
    
    [self fetchCurrentTypeList];
    [self updateWindowState];

    // Reset because the NSWindowDidBecomeKeyNotification is also fired when the window is already
    // open (but lost and subsequently regained its key status). In this case, the state should not
    // be reset.
    updateTypeList = NO;
  }
}


//----------------------------------------------------------------------------
// NSTableSource

- (NSInteger) numberOfRowsInTableView: (NSTableView *)tableView {
  return typeCells.count;
}

- (id) tableView:(NSTableView *)tableView objectValueForTableColumn:(NSTableColumn *)column
             row:(NSInteger)row {
  return [typeCells[row] uniformType].uniformTypeIdentifier;
}


- (id<NSPasteboardWriting>)tableView:(NSTableView *)tableView
              pasteboardWriterForRow:(NSInteger)row {
  return [[[InternalPasteboardWriter alloc] initWithSourceRow: row] autorelease];
}

- (NSDragOperation) tableView:(NSTableView *)tableView
                 validateDrop:(id <NSDraggingInfo>)info
                  proposedRow:(NSInteger)row
        proposedDropOperation:(NSTableViewDropOperation)op {
  if (op == NSTableViewDropAbove) {
    // Only allow drops in between two existing rows as otherwise it is not clear to the user where
    // the dropped item will be moved to.
  
    NSUInteger  fromRow = [self getRowNumberFromDraggingInfo: info];
    if (row < fromRow || row > fromRow + 1) {
      // Only allow drops that actually result in a move.
      
      return NSDragOperationMove;
    }
  }

  return NSDragOperationNone;
}

- (BOOL) tableView:(NSTableView *)tableView
        acceptDrop:(id <NSDraggingInfo>)info
               row:(NSInteger)row
     dropOperation:(NSTableViewDropOperation)op {

  NSUInteger  i = [self getRowNumberFromDraggingInfo: info];

  if (i > row) {
    while (i > row) {
      [self moveCellUpFromIndex: i];
      i--;
    }
  }
  else {
    NSUInteger  max_i = row - 1;
    while (i < max_i) {
      [self moveCellDownFromIndex: i];
      i++;
    }
  }
  
  [self movedCellToIndex: i];
  
  return YES;
}


//----------------------------------------------------------------------------
// Delegate methods for NSTable

- (void) tableView:(NSTableView *)tableView
   willDisplayCell:(id)cell
    forTableColumn:(NSTableColumn *)aTableColumn
               row:(NSInteger)row {
  NSAssert2(row < typeCells.count, @"%ld >= %ld", row, typeCells.count);

  TypeCell  *typeCell = typeCells[row];
  NSString  *uti = typeCell.uniformType.uniformTypeIdentifier;

  NSMutableAttributedString  *cellValue = 
    [[[NSMutableAttributedString alloc] initWithString: uti] autorelease];

  if (typeCell.isDominated) {
    [cellValue addAttribute: NSForegroundColorAttributeName
                      value: NSColor.grayColor
                      range: NSMakeRange(0, cellValue.length)];
  }
  
  [cell setAttributedStringValue: cellValue];
}

- (NSString *)tableView:(NSTableView *)tableView
         toolTipForCell:(NSCell *)cell
                   rect:(NSRectPointer)rect
            tableColumn:(NSTableColumn *)tableColumn
                    row:(NSInteger)row
          mouseLocation:(NSPoint)mouseLocation {
  TypeCell  *typeCell = typeCells[row];

  return typeCell.toolTip;
}

- (void) tableViewSelectionDidChange: (NSNotification *)notification {
  [self updateWindowState];
}

@end // @implementation UniformTypeRankingWindowControl


@implementation UniformTypeRankingWindowControl (PrivateMethods)

// Updates the window state to reflect the state of the uniform type ranking
- (void) fetchCurrentTypeList {
  [typeCells removeAllObjects];
  
  NSArray  *currentRanking = typeRanking.rankedUniformTypes;
  
  for (UniformType *type in [currentRanking objectEnumerator]) {
    BOOL  dominated = [typeRanking isUniformTypeDominated: type];
    TypeCell  *typeCell = [[[TypeCell alloc] initWithUniformType: type
                                                       dominated: dominated] autorelease];

    [typeCells addObject: typeCell];
  }
  
  [typesTable reloadData]; 
  [typesTable selectRowIndexes: [NSIndexSet indexSetWithIndex: 0]
          byExtendingSelection: NO];
}

// Commits changes made in the window to the uniform type ranking.
- (void) commitChangedTypeList {
  NSMutableArray  *newRanking = [NSMutableArray arrayWithCapacity: typeCells.count];
    
  for (TypeCell *typeCell in [typeCells objectEnumerator]) {
    [newRanking addObject: typeCell.uniformType];
  }
  
  [typeRanking updateRankedUniformTypes: newRanking];
}


- (void) closeWindow {
  [self.window close];
  
  // Force update of the type list again when the window appears again. This ensures that any
  // changes are undone if the user closed the window by pressing "Cancel".
  updateTypeList = YES;
}


- (void) updateWindowState {
  NSInteger  i = typesTable.selectedRow;
  NSUInteger  numCells =  typeCells.count;
  
  NSAssert(i >= 0 && i < numCells, @"Invalid selected type.");
  
  TypeCell  *typeCell = typeCells[i];
  
  revealButton.enabled = typeCell.isDominated;
  hideButton.enabled = !typeCell.isDominated && (i < numCells - 1);

  moveUpButton.enabled = i > 0;
  moveToTopButton.enabled = i > 0;

  moveDownButton.enabled = i < numCells - 1;
  moveToBottomButton.enabled = i < numCells - 1;
}


- (void) moveCellUpFromIndex:(NSUInteger)index {
  TypeCell  *upCell = typeCells[index];
  TypeCell  *downCell = typeCells[index - 1];
  
  // Swap the cells
  [typeCells exchangeObjectAtIndex: index withObjectAtIndex: index - 1];

  // Check if the dominated status of upCell changed.
  if (upCell.isDominated) {
    NSSet  *ancestors = upCell.uniformType.ancestorTypes;

    if ([ancestors containsObject: downCell.uniformType]) {
      // downCell was an ancestor of upCell, so upCell may not be dominated anymore.
      
      NSUInteger  i = 0;
      NSUInteger  max_i = index - 1;
      BOOL  dominated = NO;
      while (i < max_i && !dominated) {
        UniformType  *higherType = ((TypeCell *)typeCells[i]).uniformType;
        
        if ([ancestors containsObject: higherType]) {
          dominated = YES;
        }
        
        i++;
      }
      
      if (! dominated) {
        [upCell setDominated: NO];
      }
    }
  }
  
  // Check if the dominated status of downCell changed.
  if (!downCell.isDominated) {
    NSSet  *ancestors = downCell.uniformType.ancestorTypes;
    
    if ([ancestors containsObject: upCell.uniformType]) {
      [downCell setDominated: YES];
    }
  }
}

- (void) moveCellDownFromIndex:(NSUInteger)index {
  [self moveCellUpFromIndex: index + 1];
}

/* Update the window after a cell has been moved.
 */
- (void) movedCellToIndex:(NSUInteger)index {
  [typesTable selectRowIndexes: [NSIndexSet indexSetWithIndex: index]
          byExtendingSelection: NO];
  [typesTable reloadData];
  [self updateWindowState];
}


- (NSUInteger) getRowNumberFromDraggingInfo:(id <NSDraggingInfo>)info {
  NSData  *data = [info.draggingPasteboard dataForType: InternalTableDragType];

  NSError  *error = nil;
  NSNumber  *rowNum = [NSKeyedUnarchiver unarchivedObjectOfClass: NSNumber.class
                                                        fromData: data
                                                           error: &error];
  NSAssert(error == nil, @"Error while decoding dragging info: %@", error.description);

  return rowNum.unsignedIntegerValue;
}

@end // @implementation UniformTypeRankingWindowControl (PrivateMethods)


@implementation InternalPasteboardWriter

- (instancetype) initWithSourceRow:(NSInteger)rowVal {
  if (self = [super init]) {
    row = rowVal;
  }

  return self;
}

//----------------------------------------------------------------------------
// NSPasteboardWriting

- (NSArray<NSPasteboardType> *)writableTypesForPasteboard:(NSPasteboard *)pasteboard {
  return @[InternalTableDragType];
}

- (NSPasteboardWritingOptions)writingOptionsForType:(NSPasteboardType)type
                                         pasteboard:(NSPasteboard *)pasteboard {
  return 0;
}

- (id)pasteboardPropertyListForType:(NSPasteboardType)type {
  NSError  *error = nil;
  NSData  *data = [NSKeyedArchiver archivedDataWithRootObject: @(row)
                                        requiringSecureCoding: YES
                                                        error: &error];
  NSAssert2(error == nil, @"Error creating pb type for row %ld: %@", (long)row, error.description);
  return data;
}

@end


@implementation TypeCell

- (instancetype) initWithUniformType:(UniformType *)typeVal dominated:(BOOL)dominatedVal {
  if (self = [super init]) {
    type = [typeVal retain];
    dominated = dominatedVal;
  }
  
  return self;
}

- (void) dealloc {
  [type release];
  
  [super dealloc];
}

- (UniformType *)uniformType {
  return type;
}

- (BOOL) isDominated {
  return dominated;
}

- (void) setDominated:(BOOL)flag {
  dominated = flag;
}

- (NSString *)toolTip {
  NSMutableString  *toolTip = [NSMutableString stringWithCapacity: 64];

  if (type.description) {
    [toolTip appendString: type.description];
  }

  NSMutableString  *conformsTo = [NSMutableString stringWithCapacity: 64];
  for (UniformType *parentType in [type.parentTypes objectEnumerator]) {
    if (conformsTo.length > 0) {
      [conformsTo appendString: @", "];
    } else {
      [conformsTo appendString: NSLocalizedString(@"Conforms to:",
                                                  @"Part of tool tip for uniform types")];
      [conformsTo appendString: @" "]; // Don't make trailing space part of translation text
    }
    [conformsTo appendString: parentType.uniformTypeIdentifier];
  }

  if (conformsTo.length > 0) {
    if (toolTip.length > 0) {
      [toolTip appendString: @"\n"];
    }
    [toolTip appendString: conformsTo];
  } else {
    if (toolTip.length == 0) {
      // Ensure each row has a tooltip, but do not unnecessarily add it. Amongst others, this
      // avoids it from being added to "unknown type", where it does not make sense.
      [toolTip appendString: NSLocalizedString(@"Top-level type",
                                               @"Part of tool tip for uniform types")];
    }
  }

  return toolTip;
}

@end // @implementation TypeCell
