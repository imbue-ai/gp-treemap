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

#import "ItemPathModelView.h"


#import "DirectoryItem.h" // Imports FileItem.h
#import "ItemPathModel.h"
#import "ItemPathBuilder.h"
#import "ItemLocator.h"
#import "PreferencesPanelControl.h"
#import "TreeDrawerBaseSettings.h"


static const unsigned STICK_TO_ENDPOINT = 0xFFFF;


@interface ItemPathModelView (PrivateMethods)

/* Updates its own state, based on the underlying model and its own settings.
 */
- (void) updatePath;

/* Updates the selected item in the underlying model, given the settings of the view.
 */
- (void) updateSelectedItemInModel;

/* Returns the index in the fileItemPath corresponding to the given file item. When package contents
 * are hidden and the given item resides insides a package, then the index will end up pointing to
 * the package containing the item, as opposed to the item directly.
 */
- (unsigned) indexCorrespondingToItem:(FileItem *)targetItem
                           startingAt:(unsigned) index;
- (unsigned) indexCorrespondingToItem:(FileItem *)targetItem
                           startingAt:(unsigned) index
                               stopAt:(unsigned) maxIndex;

/* Sends selection-changed events, which comprise selection-changes inside the path, as well as
 * selection of "invisible" items outside the path.
 */
- (void) postSelectedItemChanged:(NSNotification *)originalNotification;
- (void) postVisibleTreeChanged;

- (void) selectedItemChanged:(NSNotification *)notification;
- (void) visibleTreeChanged:(NSNotification *)notification;

@end


@implementation ItemPathModelView

- (instancetype) initWithPathModel:(ItemPathModel *)pathModelVal {
  if (self = [super init]) {
    pathModel = [pathModelVal retain];
    pathBuilder = [[ItemPathBuilder alloc] init];
    itemLocator = [[ItemLocator alloc] init];
    fileItemPath =
      (NSMutableArray *)[[pathModel fileItemPath: [NSMutableArray arrayWithCapacity: 16]] retain];
    scanTreeIndex = [self indexCorrespondingToItem: pathModel.scanTree startingAt: 0];
    
    invisibleSelectedItem = nil;
    _drawItems = DRAW_FILES;
    _displayDepth = NO_DISPLAY_DEPTH_LIMIT;
    
    [self updatePath];
    
    automaticallyStickToEndPoint = YES;
    if (automaticallyStickToEndPoint && !self.canMoveSelectionDown) {
      // We're at the end-point. Make depth stick to end-point. 
      preferredSelectionDepth = STICK_TO_ENDPOINT;
    }
    else {
      preferredSelectionDepth = selectedItemIndex - visibleTreeIndex; 
    }

    keyboardNavigationDelta = [NSUserDefaults.standardUserDefaults
                               floatForKey: KeyboardNavigationDeltaKey];
    if (keyboardNavigationDelta <= 0) {
      NSLog(@"Invalid value for keyboardNavigationDelta.");
      keyboardNavigationDelta = 5;
    }
    
    NSNotificationCenter  *nc = NSNotificationCenter.defaultCenter;
    [nc addObserver: self
           selector: @selector(selectedItemChanged:)
               name: SelectedItemChangedEvent
             object: pathModel];
    [nc addObserver: self
           selector: @selector(visibleTreeChanged:)
               name: VisibleTreeChangedEvent
             object: pathModel];
  }
  
  return self;
}

- (void) dealloc {
  [NSNotificationCenter.defaultCenter removeObserver: self];
  
  [pathBuilder release];
  [pathModel release];
  [itemLocator release];
  [fileItemPath release];
  [invisibleSelectedItem release];
  
  [super dealloc];
}

/* Returns the path model that is wrapped by this view.
 */
- (ItemPathModel *)pathModel {
  return pathModel;
}


- (void) setDrawItems:(DrawItemsEnum)drawItems {
  if (_drawItems != drawItems) {
    _drawItems = drawItems;
    
    [self updatePath];
  }
}

- (void) setDisplayDepth:(unsigned)displayDepth {
  if (_displayDepth != displayDepth) {
    _displayDepth = displayDepth;

    [self updatePath];
  }
}


- (void) selectItemAtPoint:(NSPoint)point
            startingAtTree:(FileItem *)treeRoot
        usingLayoutBuilder:(TreeLayoutBuilder *)layoutBuilder
                    bounds:(NSRect)bounds {
  
  FileItem  *oldInvisibleSelectedItem = invisibleSelectedItem;
  
  // Don't generate notifications while the path is being built.
  [pathModel suppressSelectedItemChangedNotifications: YES];
  
  // Get the item at the given point (updating the path as far as possible)
  FileItem  *itemAtPoint = [pathBuilder itemAtPoint: point
                                     startingAtTree: treeRoot
                                 usingLayoutBuilder: layoutBuilder
                                             bounds: bounds
                                         updatePath: pathModel];
  
  [self updateSelectedItemInModel];
  
  [pathModel suppressSelectedItemChangedNotifications: NO]; 

  if ([self.visibleTree isAncestorOfFileItem: itemAtPoint]) {
    // The item is inside the visible tree. The selection can therefore be managed using the
    // fileItemPath array.
    [invisibleSelectedItem release]; 
    invisibleSelectedItem = nil;
  }
  else {
    // The item is outside the visible tree. The fileItemPath array can therefore not be used to
    // manage its selection, so this needs to be done explicitly.
    
    NSAssert(pathModel.selectedFileItem == pathModel.visibleTree,
             @"Unexpected pathModel state.");
    
    [invisibleSelectedItem release];
    invisibleSelectedItem = [itemAtPoint retain];
  }
  
  if (oldInvisibleSelectedItem != invisibleSelectedItem) {
    // Only post changes here to the invisible item. When the selected item in the path changed,
    // -selectedItemChanged will be notified and post the event in response.
    [self postSelectedItemChanged: nil];
  }
}

- (void) moveSelectedItem:(DirectionEnum) direction
           startingAtTree:(FileItem *)treeRoot
       usingLayoutBuilder:(TreeLayoutBuilder *)layoutBuilder
                   bounds:(NSRect) bounds {
  NSRect rect = [itemLocator locationForItem: pathModel.selectedFileItem
                                      onPath: pathModel.itemPathToSelectedFileItem
                              startingAtTree: treeRoot
                          usingLayoutBuilder: layoutBuilder
                                      bounds: bounds];
  if (!NSPointInRect(keyboardNavigationPos, rect)) {
    keyboardNavigationPos = NSMakePoint(NSMidX(rect), NSMidY(rect));
  }

  NSPoint pos = keyboardNavigationPos;
  switch (direction) {
    case DirectionUp:    pos.y = NSMaxY(rect) + keyboardNavigationDelta; break;
    case DirectionDown:  pos.y = NSMinY(rect) - keyboardNavigationDelta; break;
    case DirectionRight: pos.x = NSMaxX(rect) + keyboardNavigationDelta; break;
    case DirectionLeft:  pos.x = NSMinX(rect) - keyboardNavigationDelta; break;
  }

  if (NSPointInRect(pos, bounds)) {
    FileItem  *oldSelectedItem = pathModel.selectedFileItem;

    [self selectItemAtPoint: pos
             startingAtTree: treeRoot
         usingLayoutBuilder: layoutBuilder
                     bounds: bounds];

    if (oldSelectedItem != pathModel.selectedFileItem) {
      // In the movement direction, center the coordinate inside the newly selected rectangle.

      rect = [itemLocator locationForItem: pathModel.selectedFileItem
                                   onPath: pathModel.itemPathToSelectedFileItem
                           startingAtTree: treeRoot
                       usingLayoutBuilder: layoutBuilder
                                   bounds: bounds];
      switch (direction) {
        case DirectionUp:    // Fall-through
        case DirectionDown:  pos.y = NSMidY(rect); break;
        case DirectionRight: // Fall-through
        case DirectionLeft:  pos.x = NSMidX(rect); break;
      }

      keyboardNavigationPos = pos;
    } else {
      NSLog(@"Selected item did not change when navigating via keyboard");
    }
  }
}


- (DirectoryItem *)volumeTree {
  return pathModel.volumeTree;
}

- (DirectoryItem *)scanTree {
  return pathModel.scanTree;
}

- (FileItem *)visibleTree {
  return fileItemPath[visibleTreeIndex];
}


- (FileItem *)selectedFileItem {
  FileItem  *selectedItem = self.selectedFileItemInTree;
  
  return (_drawItems == DRAW_PACKAGES && selectedItem.isDirectory)
         ? ((DirectoryItem *)selectedItem).itemWhenHidingPackageContents
         : selectedItem;
}

- (FileItem *)selectedFileItemInTree {
  return invisibleSelectedItem != nil
         ? invisibleSelectedItem
         : fileItemPath[selectedItemIndex];
}


- (BOOL) isSelectedFileItemVisible {
  return (invisibleSelectedItem == nil);
}


- (BOOL) canMoveVisibleTreeUp {
  return (visibleTreeIndex > scanTreeIndex);
}

- (BOOL) canMoveVisibleTreeDown {
  return (visibleTreeIndex < selectedItemIndex);
}

- (void) moveVisibleTreeUp {
  NSAssert(self.canMoveVisibleTreeUp, @"Cannot move visible tree up.");

  // May require multiple moves in the wrapped model, as the visible tree there could be inside a
  // package.
  FileItem  *newVisibleTree = fileItemPath[visibleTreeIndex - 1];

  [pathModel suppressVisibleTreeChangedNotifications: YES];
  do {
    [pathModel moveVisibleTreeUp];
  } while (pathModel.visibleTree != newVisibleTree);
  [pathModel suppressVisibleTreeChangedNotifications: NO];
}

- (void) moveVisibleTreeDown {
  NSAssert(self.canMoveVisibleTreeDown, @"Cannot move visible tree down.");
  
  [pathModel moveVisibleTreeDown];
}



- (BOOL) selectionSticksToEndPoint {
  return (preferredSelectionDepth == STICK_TO_ENDPOINT);
}

- (void) setSelectionSticksToEndPoint: (BOOL)value { 
  if (value) {
    preferredSelectionDepth = STICK_TO_ENDPOINT;
    
    [pathModel selectFileItem: fileItemPath[lastSelectableItemIndex]];
  }
  else {
    // Preferred depth is the current one. The selection does not change.
    preferredSelectionDepth = selectedItemIndex - visibleTreeIndex;
  }
}


- (BOOL) selectionSticksAutomaticallyToEndPoint {
  return automaticallyStickToEndPoint;
}

- (void) setSelectionSticksAutomaticallyToEndPoint:(BOOL)flag {
  automaticallyStickToEndPoint = flag;
}


- (BOOL) canMoveSelectionUp {
  return (selectedItemIndex > visibleTreeIndex);
}

- (BOOL) canMoveSelectionDown {
  return (selectedItemIndex < lastSelectableItemIndex);
}

- (void) moveSelectionUp {
  NSAssert(self.canMoveSelectionUp, @"Cannot move selection up");
  
  // If preferred depth was sticky, it is not anymore.
  preferredSelectionDepth = selectedItemIndex - 1 - visibleTreeIndex;
  
  [pathModel selectFileItem: fileItemPath[selectedItemIndex - 1]];
}

- (void) moveSelectionDown {
  NSAssert(self.canMoveSelectionDown, @"Cannot move selection down.");
  
  [pathModel selectFileItem: fileItemPath[selectedItemIndex + 1]];
    
  if (automaticallyStickToEndPoint && !self.canMoveSelectionDown) {
    // End-point reached. Make depth stick to end-point automatically 
    preferredSelectionDepth = STICK_TO_ENDPOINT;
  }
  else {
    preferredSelectionDepth = selectedItemIndex + 1 - visibleTreeIndex; 
  }
}

@end


@implementation ItemPathModelView (PrivateMethods)

- (void) updatePath {
  NSArray  *updatedPath = [pathModel fileItemPath: fileItemPath];
  NSAssert(updatedPath == fileItemPath, @"Arrays differ unexpectedly.");

  // Set the visible item
  visibleTreeIndex = [self indexCorrespondingToItem: pathModel.visibleTree
                                         startingAt: scanTreeIndex];

  // Set the selected item
  selectedItemIndex = [self indexCorrespondingToItem: pathModel.selectedFileItem
                                          startingAt: visibleTreeIndex
                                              stopAt: visibleTreeIndex + _displayDepth];

  // Find the last item that can be selected
  lastSelectableItemIndex = [self indexCorrespondingToItem: nil
                                                startingAt: selectedItemIndex
                                                    stopAt: visibleTreeIndex + _displayDepth];
}


- (void) updateSelectedItemInModel {
  NSArray  *updatedPath = [pathModel fileItemPath: fileItemPath];
  NSAssert(updatedPath == fileItemPath, @"Arrays differ unexpectedly.");
  
  // Set the visible item
  visibleTreeIndex = [self indexCorrespondingToItem: pathModel.visibleTree
                                         startingAt: scanTreeIndex];
            
  // Find the last item that can be selected
  lastSelectableItemIndex = [self indexCorrespondingToItem: nil
                                                startingAt: visibleTreeIndex
                                                    stopAt: visibleTreeIndex + _displayDepth];
    
  int  indexToSelect;
  if (preferredSelectionDepth == STICK_TO_ENDPOINT) {
    indexToSelect = lastSelectableItemIndex;
  }
  else {
    indexToSelect = MIN(visibleTreeIndex + preferredSelectionDepth, lastSelectableItemIndex);
  }

  [pathModel selectFileItem: fileItemPath[indexToSelect]];
}


- (unsigned) indexCorrespondingToItem:(FileItem *)targetItem startingAt:(unsigned)index {
  return [self indexCorrespondingToItem: targetItem
                             startingAt: index
                                 stopAt: (unsigned)fileItemPath.count - 1];
}

- (unsigned) indexCorrespondingToItem:(FileItem *)targetItem
                           startingAt:(unsigned) startIndex
                               stopAt:(unsigned) maxIndex {
  unsigned index = startIndex;
  maxIndex = MIN(maxIndex, (unsigned)fileItemPath.count - 1);

  while (YES) {
    FileItem  *fileItem = fileItemPath[index];
    
    if (_drawItems == DRAW_FOLDERS && !fileItem.isDirectory) {
      // Reached a file. Retreat to parent folder.
      NSAssert(index > startIndex, @"Cannot back-up to parent folder");
      --index;
      break;
    }

    if (fileItem == targetItem) {
      // Found the target item
      break;
    }

    if ((_drawItems == DRAW_PACKAGES || _drawItems == DRAW_FOLDERS) &&
        fileItem.isDirectory &&
        ((DirectoryItem *)fileItem).isPackage) {
      // Reached a package whose contents should remain hidden
      break;
    }

    if (index == maxIndex) {
      // Reached the end of the array
      break;
    }
    
    index++;
  }
  
  return index;
}

- (void) postSelectedItemChanged:(NSNotification *)origNotification {
  [NSNotificationCenter.defaultCenter postNotificationName: SelectedItemChangedEvent
                                                    object: self
                                                  userInfo: origNotification.userInfo];
}

- (void) postVisibleTreeChanged {
  [NSNotificationCenter.defaultCenter postNotificationName: VisibleTreeChangedEvent
                                                    object: self];
}


// Called when selection changes in path
- (void) selectedItemChanged:(NSNotification *)notification {
  if (invisibleSelectedItem != nil) {
    // Set the view's selected item to that of the path.
    [invisibleSelectedItem release]; 
    invisibleSelectedItem = nil;
  }
  
  [self updatePath];

  // Propagate event to my listeners.
  [self postSelectedItemChanged: notification];
}

- (void) visibleTreeChanged:(NSNotification *)notification {
  [self updatePath];
   
  // Propagate event to my listeners.
  [self postVisibleTreeChanged];
}

@end // ItemPathModelView (PrivateMethods)
